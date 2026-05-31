"""AI panel helpers for the executive dashboard renderer."""

from __future__ import annotations

import html as _html

AI_CSS = """
.ai-panel{margin-top:14px;border-top:1px solid #21262d;padding-top:12px}
.ai-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.ai-chip{background:#161b22;border:1px solid #21262d;border-radius:999px;padding:3px 11px;
         font-size:11px;cursor:pointer;color:#8b949e;transition:border-color .15s,color .15s}
.ai-chip:hover{border-color:#58a6ff;color:#e6edf3}
.ai-out{font-size:12px;line-height:1.7;color:#e6edf3;background:#0d1117;border-radius:6px;
        padding:8px;margin-top:6px;white-space:pre-wrap;display:none;max-height:200px;overflow-y:auto}
.ai-out.active{display:block}
.ai-input-row{display:flex;gap:6px;margin-top:8px}
.ai-input{flex:1;background:#0d1117;border:1px solid #30363d;border-radius:6px;
          padding:5px 8px;color:#e6edf3;font-size:12px;outline:none}
.ai-input:focus{border-color:#58a6ff}
.ai-btn{background:#1f6feb;border:none;border-radius:6px;color:#fff;
        padding:5px 12px;cursor:pointer;font-size:12px}
.ai-btn:hover{background:#388bfd}
.ai-btn-save{background:#238636;margin-top:8px}
.ai-btn-save:hover{background:#2ea043}
.ai-btn-save:disabled{background:#21262d;color:#6e7681;cursor:default}
"""

AI_MODAL_HTML = """<div class="ai-panel">
  <div class="ai-chips">
    <button class="ai-chip" onclick="askAI('What is the best way to resolve this?')">Resolve</button>
    <button class="ai-chip" onclick="askAI('Draft a meeting agenda to address this.')">Schedule Meeting</button>
    <button class="ai-chip" onclick="askAI('Draft a professional email reply for this.')">Draft Reply</button>
    <button class="ai-chip" onclick="askAI('Summarize the key points of this item.')">Summarize</button>
    <button class="ai-chip" id="meeting-prep-chip" onclick="meetingPrep()" style="display:none;background:#0d2a1a;border-color:#238636;color:#3fb950">Meeting Prep</button>
  </div>
  <div class="ai-out" id="ai-out"></div>
  <button class="ai-btn ai-btn-save" id="save-draft-btn" onclick="saveDraft()" style="display:none">Save to Drafts</button>
  <div class="ai-input-row">
    <input class="ai-input" id="ai-input" placeholder="Ask AI about this item…"
           onkeydown="if(event.key==='Enter'&&this.value.trim())askAI(this.value)">
    <button class="ai-btn" onclick="askAI(document.getElementById('ai-input').value)">Ask</button>
  </div>
</div>"""

AI_JS = """
function parseCtx(ctx){
  const lines=ctx.split('\\n'),title=lines[0]||'',obj={};
  lines.slice(1).forEach(l=>{const i=l.indexOf(': ');if(i>0)obj[l.slice(0,i).toLowerCase()]=l.slice(i+2);});
  return{title,...obj};
}
async function saveDraft(){
  const p=parseCtx(currentCtx);
  const subject=p.subject||p.title||'(no subject)';
  const toEmail=(p.from||p.sender||'').replace(/.*<(.+)>.*$/,'$1').trim();
  const body=document.getElementById('ai-out').textContent;
  const btn=document.getElementById('save-draft-btn');
  btn.textContent='Saving…';btn.disabled=true;
  try{
    const r=await fetch('/api/dashboard/save-draft',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({subject:'Re: '+subject,to_email:toEmail,body})
    });
    const data=await r.json();
    btn.textContent=r.ok?'✓ Saved to Drafts':'Save failed: '+(data.detail||'unknown error');
    if(!r.ok)btn.disabled=false;
  }catch(e){btn.textContent='Save failed';btn.disabled=false;}
}
async function meetingPrep(){
  const out=document.getElementById('ai-out'),btn=document.getElementById('save-draft-btn');
  if(!out)return;
  if(btn){btn.style.display='none';btn.disabled=false;btn.textContent='Save to Drafts';}
  out.textContent='⋯';out.classList.add('active');
  const lines=currentCtx.split('\\n');
  const subject=lines[0]||'';
  const atLine=lines.find(l=>l.startsWith('Attendees: '))||'';
  const attendees=atLine?atLine.replace('Attendees: ','').split(',').map(e=>e.trim()).filter(e=>e&&e!=='—'):[];
  const timeLine=lines.find(l=>l.startsWith('Time: '))||'';
  const startTime=timeLine.replace('Time: ','').trim();
  if(!attendees.length){askAI('Generate a meeting prep brief with agenda and talking points.');return;}
  try{
    const resp=await fetch('/api/dashboard/meeting-prep',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({subject,start_time:startTime,attendee_emails:attendees})
    });
    const reader=resp.body.getReader(),dec=new TextDecoder();
    out.textContent='';
    while(true){
      const{done,value}=await reader.read();if(done)break;
      dec.decode(value).split('\\n').forEach(line=>{
        if(!line.startsWith('data:'))return;
        try{const d=JSON.parse(line.slice(5));if(d.type==='token')out.textContent+=d.text;}catch(e){}
      });
    }
  }catch(e){out.textContent='Error: '+e.message;}
}
async function askAI(query){
  if(!query||!query.trim())return;
  const out=document.getElementById('ai-out'),btn=document.getElementById('save-draft-btn');
  if(!out)return;
  if(btn){btn.style.display='none';btn.disabled=false;btn.textContent='Save to Drafts';}
  out.textContent='⋯';out.classList.add('active');
  try{
    const resp=await fetch('/api/dashboard/ask',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({query,context:currentCtx})
    });
    const reader=resp.body.getReader(),dec=new TextDecoder();
    out.textContent='';
    while(true){
      const{done,value}=await reader.read();if(done)break;
      dec.decode(value).split('\\n').forEach(line=>{
        if(!line.startsWith('data:'))return;
        try{const d=JSON.parse(line.slice(5));if(d.type==='token')out.textContent+=d.text;}
        catch(e){}
      });
    }
    if(btn&&/draft|reply/i.test(query)){btn.style.display='block';}
  }catch(e){out.textContent='Error: '+e.message;}
}
"""


def _onedrive_html(files: list[dict]) -> str:
    if not files:
        return "<p style='color:#6e7681;font-size:13px'>No recent OneDrive files found.</p>"
    items = []
    for f in files[:8]:
        name = (f.get("name") or "Untitled")[:60]
        url  = _html.escape(f.get("webUrl", "#"), quote=True)
        mod  = (f.get("lastModifiedDateTime") or "")[:10]
        items.append(
            f'<li><a href="{url}" target="_blank" rel="noopener">{_html.escape(name)}</a>'
            f'<div class="meta">{mod}</div></li>'
        )
    return f'<ul class="item-list">{"".join(items)}</ul>'


def _teams_html(chats: list[dict]) -> str:
    if not chats:
        return "<p style='color:#6e7681;font-size:13px'>Teams chats are only available with a work or school Microsoft account.</p>"
    items = []
    for c in chats[:8]:
        topic   = _html.escape((c.get("topic") or c.get("chatType") or "Chat")[:60])
        preview = ((c.get("lastMessagePreview") or {}).get("body") or {}).get("content", "")
        items.append(f'<li>{topic}<div class="meta">{_html.escape(preview[:80])}</div></li>')
    return f'<ul class="item-list">{"".join(items)}</ul>'
