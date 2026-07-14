"""Social platform autopilot workers — LinkedIn and Instagram scheduled posting."""
import asyncio


async def _linkedin_scheduler_loop(app: "object") -> None:
    """Publish scheduled LinkedIn posts when their scheduled_at time arrives."""
    while True:
        try:
            cache = app.state.cache
            from datetime import datetime, timedelta
            now = datetime.now()
            now_str = now.strftime("%Y-%m-%dT%H:%M")
            cutoff_str = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")
            with cache._conn() as conn:
                rows = conn.execute(
                    "SELECT * FROM linkedin_posts WHERE status='scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 10",
                    (now_str,),
                ).fetchall()
            for row in rows:
                try:
                    # Posts more than 1 hour overdue were stuck due to missing scheduler — mark failed
                    if (row["scheduled_at"] or "") < cutoff_str:
                        with cache._conn() as conn:
                            conn.execute(
                                "UPDATE linkedin_posts SET status='missed' WHERE id=?",
                                (row["id"],),
                            )
                        print(f"[linkedin-scheduler] missed (overdue) id={row['id']} was={row['scheduled_at']}")
                        continue
                    from routers.social import _publish_to_linkedin, _get_linkedin_settings
                    settings = _get_linkedin_settings()
                    result = await _publish_to_linkedin(
                        row["post_text"],
                        settings,
                        row["image_url"] or "",
                        row["content_type"] or "image+text",
                    )
                    with cache._conn() as conn:
                        if "error" in result:
                            conn.execute(
                                "UPDATE linkedin_posts SET status='failed' WHERE id=?",
                                (row["id"],),
                            )
                            print(f"[linkedin-scheduler] failed id={row['id']}: {result['error']}")
                        else:
                            conn.execute(
                                """UPDATE linkedin_posts
                                   SET status='published', published_at=datetime('now'),
                                       linkedin_post_id=?
                                   WHERE id=?""",
                                (result.get("linkedin_post_id", ""), row["id"]),
                            )
                            print(f"[linkedin-scheduler] published id={row['id']}")
                except Exception as e:
                    print(f"[linkedin-scheduler] error id={row['id']}: {e}")
        except Exception as e:
            print(f"[linkedin-scheduler] loop error: {e}")
        await asyncio.sleep(60)


async def _linkedin_autopilot_loop(app: "object") -> None:
    """Generate and publish LinkedIn posts on autopilot schedule."""
    import json, uuid
    while True:
        try:
            cache = app.state.cache
            from datetime import datetime, timedelta
            from routers.social import _get_linkedin_settings, _get_openai_key, _publish_to_linkedin

            with cache._conn() as conn:
                row = conn.execute(
                    "SELECT * FROM linkedin_autopilot WHERE enabled=1 ORDER BY id LIMIT 1"
                ).fetchone()

            if not row:
                await asyncio.sleep(300)
                continue

            now = datetime.now()
            now_str = now.strftime("%Y-%m-%dT%H:%M")
            next_post_at = row["next_post_at"] or ""

            if next_post_at and next_post_at > now_str:
                await asyncio.sleep(60)
                continue

            topics = json.loads(row["topics"] or "[]")
            if not topics:
                await asyncio.sleep(300)
                continue

            topic_index = int(row["topic_index"] or 0)
            topic = topics[topic_index % len(topics)]
            content_type = row["content_type"] or "image+text"
            template_prompt = row["template_prompt"] or ""
            require_review = int(row["require_review"] or 0) if "require_review" in row.keys() else 0
            fixed_hashtags = json.loads(row["fixed_hashtags"] or "[]") if "fixed_hashtags" in row.keys() else []

            advisor = app.state.advisor
            ant = getattr(advisor.ai, "_anthropic", None)
            post_system = (
                "You are a LinkedIn post writer. Output ONLY the post text — "
                "no JSON, no code blocks, no labels, no introductions."
            )
            if template_prompt:
                post_prompt = f"{template_prompt}\n\nTopic: {topic}\n\nOutput ONLY the post text."
            else:
                post_prompt = (
                    f"Write a professional LinkedIn post about: {topic}.\n"
                    "Engaging, well-structured with real line breaks. Emojis sparingly. "
                    "Do NOT include hashtags. Output ONLY the post text."
                )
            try:
                ai_call = ant.messages.create if ant else advisor.ai.messages.create
                resp = await ai_call(model="claude-sonnet-4-6", max_tokens=1200,
                                     system=post_system,
                                     messages=[{"role": "user", "content": post_prompt}])
                post_text = resp.content[0].text.strip()
            except Exception as e:
                print(f"[linkedin-autopilot] post generation failed for '{topic}': {e}")
                await asyncio.sleep(300)
                continue

            # Append hashtags — fixed (always included) + AI-generated
            try:
                ht_prompt = f"Give 5 LinkedIn hashtags for: {topic}. Return ONLY comma-separated words without #."
                ht_resp = await ai_call(model="claude-haiku-4-5-20251001", max_tokens=80,
                                        messages=[{"role": "user", "content": ht_prompt}])
                ai_tags = [h.strip().lstrip("#") for h in ht_resp.content[0].text.split(",") if h.strip()][:5]
            except Exception:
                ai_tags = []
            all_tags = list(dict.fromkeys(fixed_hashtags + ai_tags))
            if all_tags:
                post_text += "\n\n" + " ".join(f"#{t.lstrip('#')}" for t in all_tags)

            _IMAGE_MODEL_FALLBACKS = (
                ("gpt-image-1", {"size": "1024x1024"}),
                ("dall-e-3",    {"size": "1024x1024"}),
                ("dall-e-2",    {"size": "1024x1024"}),
            )
            image_url = ""
            if content_type in ("image", "image+text"):
                openai_key = _get_openai_key()
                if openai_key and openai_key.startswith("sk-"):
                    try:
                        style_context = f" Visual style reference: {template_prompt}." if template_prompt else ""
                        dp_prompt = (
                            f"Write a concise DALL-E image generation prompt for a professional LinkedIn post about: {topic}.{style_context} "
                            "Requirements: cinematic lighting, clean modern composition, no text, no logos, no people's faces, business-appropriate. "
                            "Return ONLY the prompt text, 1-2 sentences."
                        )
                        dp_resp = await ai_call(model="claude-haiku-4-5-20251001", max_tokens=120,
                                                messages=[{"role": "user", "content": dp_prompt}])
                        dalle_prompt = dp_resp.content[0].text.strip()
                    except Exception:
                        dalle_prompt = (
                            f"{template_prompt} {topic}." if template_prompt
                            else f"Professional LinkedIn post image for: {topic}. Clean, modern, business-appropriate."
                        )
                    try:
                        import httpx, base64 as _b64
                        async with httpx.AsyncClient(timeout=120.0) as http:
                            for _img_model, _img_params in _IMAGE_MODEL_FALLBACKS:
                                payload = {"model": _img_model, "prompt": dalle_prompt[:4000], "n": 1, **_img_params}
                                ir = await http.post(
                                    "https://api.openai.com/v1/images/generations",
                                    headers={"Authorization": f"Bearer {openai_key}", "Content-Type": "application/json"},
                                    json=payload,
                                )
                                if ir.status_code == 200:
                                    item = ir.json().get("data", [{}])[0]
                                    b64_data = item.get("b64_json", "")
                                    if not b64_data:
                                        raw_url = item.get("url", "")
                                        if raw_url:
                                            try:
                                                dl = await http.get(raw_url, follow_redirects=True)
                                                if dl.status_code == 200:
                                                    b64_data = _b64.b64encode(dl.content).decode()
                                                else:
                                                    print(f"[linkedin-autopilot] image URL download failed {dl.status_code}")
                                            except Exception as _de:
                                                print(f"[linkedin-autopilot] image URL download error: {_de}")
                                    if b64_data:
                                        image_url = "data:image/png;base64," + b64_data
                                        print(f"[linkedin-autopilot] image generated via {_img_model}")
                                        break
                                    else:
                                        print(f"[linkedin-autopilot] {_img_model} returned 200 but no image data — trying next")
                                        continue
                                else:
                                    print(f"[linkedin-autopilot] DALL-E {_img_model} {ir.status_code}: {ir.text[:200]}")
                                    continue
                    except Exception as e:
                        print(f"[linkedin-autopilot] image generation failed: {e}")

            if content_type in ("image", "image+text") and not image_url:
                print(f"[linkedin-autopilot] image generation failed for '{topic}' — publishing text-only fallback")

            post_id = str(uuid.uuid4())
            if require_review:
                with cache._conn() as conn:
                    conn.execute(
                        """INSERT INTO linkedin_posts (id, topic, post_text, image_url, content_type, status, created_at)
                           VALUES (?, ?, ?, ?, ?, 'pending_review', datetime('now'))""",
                        (post_id, topic, post_text, image_url, content_type),
                    )
                print(f"[linkedin-autopilot] '{topic}' queued for review (post {post_id})")
            else:
                settings = _get_linkedin_settings()
                result = await _publish_to_linkedin(post_text, settings, image_url, content_type)
                if "error" in result:
                    print(f"[linkedin-autopilot] publish failed for '{topic}': {result['error']}")
                    await asyncio.sleep(300)
                    continue

                with cache._conn() as conn:
                    conn.execute(
                        """INSERT INTO linkedin_posts (id, topic, post_text, image_url, content_type, status, published_at, linkedin_post_id)
                           VALUES (?, ?, ?, ?, ?, 'published', datetime('now'), ?)""",
                        (post_id, topic, post_text, image_url, content_type, result.get("linkedin_post_id", "")),
                    )

            new_index = (topic_index + 1) % len(topics)
            interval_days = int(row["interval_days"] or 7)
            post_time = row["post_time"] or "09:00"
            h, m = (post_time + ":00").split(":")[:2]
            next_dt = now + timedelta(days=interval_days)
            next_post_at_new = next_dt.strftime(f"%Y-%m-%dT{h.zfill(2)}:{m.zfill(2)}")

            with cache._conn() as conn:
                conn.execute(
                    "UPDATE linkedin_autopilot SET topic_index=?, last_post_at=?, next_post_at=? WHERE id=?",
                    (new_index, now_str, next_post_at_new, row["id"]),
                )
            print(f"[linkedin-autopilot] posted '{topic}' → next: {next_post_at_new} (topic {new_index + 1}/{len(topics)})")

        except Exception as e:
            print(f"[linkedin-autopilot] loop error: {e}")
        await asyncio.sleep(300)


async def _instagram_autopilot_loop(app: "object") -> None:
    """Generate and publish Instagram posts on autopilot schedule."""
    import json, uuid
    while True:
        try:
            cache = app.state.cache
            from datetime import datetime, timedelta
            from routers.instagram import (
                _get_instagram_settings, _get_openai_key,
                _publish_to_instagram, _upload_to_ftp, _ensure_tables,
            )

            _ensure_tables(cache)
            with cache._conn() as conn:
                row = conn.execute(
                    "SELECT * FROM instagram_autopilot WHERE enabled=1 ORDER BY id LIMIT 1"
                ).fetchone()

            if not row:
                await asyncio.sleep(300)
                continue

            now = datetime.now()
            now_str = now.strftime("%Y-%m-%dT%H:%M")
            next_post_at = row["next_post_at"] or ""

            if next_post_at and next_post_at > now_str:
                await asyncio.sleep(60)
                continue

            topics = json.loads(row["topics"] or "[]")
            if not topics:
                await asyncio.sleep(300)
                continue

            topic_index = int(row["topic_index"] or 0)
            topic = topics[topic_index % len(topics)]
            tone = row["tone"] or "Inspiring"
            hashtag_count = int(row["hashtag_count"] or 15)
            content_type = row["content_type"] or "image+text"

            advisor = app.state.advisor
            ant = getattr(advisor.ai, "_anthropic", None)
            ai_call = ant.messages.create if ant else advisor.ai.messages.create

            caption_system = (
                "You are an Instagram caption writer. Output ONLY the caption text — "
                "no JSON, no code blocks, no labels, no hashtags in the body."
            )
            caption_prompt = (
                f"Write an engaging Instagram caption about: {topic}.\n"
                f"Tone: {tone}. Use line breaks and emojis where natural. "
                "Do NOT include hashtags. Output ONLY the caption text."
            )
            try:
                resp = await ai_call(model="claude-haiku-4-5-20251001", max_tokens=600,
                                     system=caption_system,
                                     messages=[{"role": "user", "content": caption_prompt}])
                caption = resp.content[0].text.strip()
            except Exception as e:
                print(f"[ig-autopilot] caption generation failed for '{topic}': {e}")
                await asyncio.sleep(300)
                continue

            hashtags: list = []
            try:
                ht_prompt = (
                    f"Give {hashtag_count} Instagram hashtags for a post about: {topic}. "
                    "Return ONLY comma-separated words without the # symbol."
                )
                ht_resp = await ai_call(model="claude-haiku-4-5-20251001", max_tokens=120,
                                        messages=[{"role": "user", "content": ht_prompt}])
                hashtags = [h.strip().lstrip("#") for h in ht_resp.content[0].text.split(",")
                            if h.strip() and len(h.strip()) < 35][:hashtag_count]
            except Exception:
                pass

            image_url = ""
            if content_type in ("image", "image+text"):
                openai_key = _get_openai_key()
                if openai_key and openai_key.startswith("sk-"):
                    ig_settings = _get_instagram_settings()
                    img_prompt = (
                        f"Vibrant square Instagram image for a post about: {topic}. "
                        f"Tone: {tone}. Instagram-appropriate, no text overlays."
                    )
                    import httpx
                    async with httpx.AsyncClient(timeout=120.0) as http:
                        for mdl in ("dall-e-3", "dall-e-2"):
                            ir = await http.post(
                                "https://api.openai.com/v1/images/generations",
                                headers={"Authorization": f"Bearer {openai_key}", "Content-Type": "application/json"},
                                json={"model": mdl, "prompt": img_prompt[:4000], "n": 1, "size": "1024x1024"},
                            )
                            if ir.status_code == 200:
                                item = ir.json().get("data", [{}])[0]
                                raw_url = item.get("url") or (
                                    f"data:image/png;base64,{item['b64_json']}" if item.get("b64_json") else ""
                                )
                                if raw_url:
                                    if raw_url.startswith("data:") and ig_settings.get("ftp_host"):
                                        try:
                                            raw_url = await _upload_to_ftp(raw_url, ig_settings)
                                        except Exception:
                                            raw_url = ""
                                    image_url = raw_url
                                    break

            hashtag_line = " ".join(f"#{h}" for h in hashtags)
            full_caption = caption + ("\n\n" + hashtag_line if hashtag_line else "")
            settings = _get_instagram_settings()
            result = await _publish_to_instagram(settings, image_url, full_caption)
            if "error" in result:
                print(f"[ig-autopilot] publish failed for '{topic}': {result['error']}")
                await asyncio.sleep(300)
                continue

            post_id = str(uuid.uuid4())
            with cache._conn() as conn:
                conn.execute(
                    """INSERT INTO instagram_history
                       (id, caption, hashtags, image_url, content_type, status, published_at, ig_media_id)
                       VALUES (?, ?, ?, ?, ?, 'published', datetime('now'), ?)""",
                    (post_id, caption, json.dumps(hashtags), image_url, content_type,
                     result.get("ig_media_id", "")),
                )

            new_index = (topic_index + 1) % len(topics)
            interval_days = int(row["interval_days"] or 3)
            post_time = row["post_time"] or "09:00"
            h, m = (post_time + ":00").split(":")[:2]
            next_dt = now + timedelta(days=interval_days)
            next_post_at_new = next_dt.strftime(f"%Y-%m-%dT{h.zfill(2)}:{m.zfill(2)}")
            with cache._conn() as conn:
                conn.execute(
                    "UPDATE instagram_autopilot SET topic_index=?, last_post_at=?, next_post_at=? WHERE id=?",
                    (new_index, now_str, next_post_at_new, row["id"]),
                )
            print(f"[ig-autopilot] posted '{topic}' → next: {next_post_at_new} (topic {new_index + 1}/{len(topics)})")

        except Exception as e:
            print(f"[ig-autopilot] loop error: {e}")
        await asyncio.sleep(300)
