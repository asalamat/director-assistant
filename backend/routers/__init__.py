"""Router registration — extracted from main.py to keep it under 500 lines.

Imports are inside register_routers() so importing the `routers` package itself
stays cheap and avoids circular imports at module-load time.
"""


def register_routers(app):
    from routers import connection
    from routers import email_list as email_list_router
    from routers import email_ai as email_ai_router
    from routers import email_ai_compose as email_ai_compose_router
    from routers import email_ai_analyze as email_ai_analyze_router
    from routers import email_actions as email_actions_router
    from routers import digest, actions, followups, templates, analytics, sender, accounts as accounts_router
    from routers import config as config_router
    from routers import health as health_router
    from routers import oauth as oauth_router
    from routers import ask as ask_router
    from routers import ask_extras as ask_extras_router
    from routers import documents as documents_router
    from routers import intelligence as intelligence_router
    from routers import snooze as snooze_router
    from routers import saved_searches as saved_searches_router
    from routers import drafts as drafts_router
    from routers import email_send as email_send_router
    from routers import update as update_router
    from routers import dashboard as dashboard_router
    from routers import triage as triage_router
    from routers import triage_rules as triage_rules_router
    from routers import proactive as proactive_router
    from routers import scheduled_send as scheduled_send_router
    from routers import pst_import as pst_import_router
    from routers import weekly_brief as weekly_brief_router
    from routers import db_maintenance as db_maintenance_router
    from routers import autopilot as autopilot_router
    from routers import vip as vip_router
    from routers import projects as projects_router
    from routers import contacts as contacts_router
    from routers import meeting as meeting_router
    from routers import crm as crm_router
    from routers import tracking as tracking_router
    from routers import notify as notify_router
    from routers import backup as backup_router
    from routers import tasks_export as tasks_export_router
    from routers import webhooks as webhooks_router
    from routers import report_schedule as report_schedule_router
    from routers import delegations as delegations_router
    from routers import overnight as overnight_router
    from routers import email_rules as email_rules_router
    from routers import voice as voice_router
    from routers import signatures as signatures_router
    from routers import snippets as snippets_router
    from routers import rag as rag_router
    from routers import knowledge_graph as knowledge_graph_router
    from routers import jobs as jobs_router
    from routers import social as social_router
    from routers import instagram as instagram_router
    from routers import card_studio as card_studio_router
    from routers import nl_commands as nl_commands_router
    from routers import commitments as commitments_router
    from routers import social_inbox as social_inbox_router
    from routers import weather as weather_router
    from routers import news as news_router
    from routers.contact_health import router as contact_health_router
    from routers.morning_brief import router as morning_brief_router
    from routers.morning_plan import router as morning_plan_router
    from routers.calendar import router as calendar_router
    from routers import streak as streak_router

    app.include_router(connection.router)
    app.include_router(email_list_router.router)
    app.include_router(email_ai_router.router)
    app.include_router(email_ai_compose_router.router)
    app.include_router(email_ai_analyze_router.router)
    app.include_router(email_actions_router.router)
    app.include_router(digest.router)
    app.include_router(actions.router)
    app.include_router(followups.router)
    app.include_router(templates.router)
    app.include_router(analytics.router)
    app.include_router(sender.router)
    app.include_router(accounts_router.router)
    app.include_router(config_router.router)
    app.include_router(health_router.router)
    app.include_router(oauth_router.router)
    app.include_router(ask_router.router)
    app.include_router(ask_extras_router.router)
    app.include_router(documents_router.router)
    app.include_router(intelligence_router.router)
    app.include_router(snooze_router.router)
    app.include_router(saved_searches_router.router)
    app.include_router(drafts_router.router)
    app.include_router(email_send_router.router)
    app.include_router(update_router.router)
    app.include_router(dashboard_router.router)
    app.include_router(triage_router.router)
    app.include_router(triage_rules_router.router)
    app.include_router(proactive_router.router)
    app.include_router(scheduled_send_router.router)
    app.include_router(pst_import_router.router)
    app.include_router(weekly_brief_router.router)
    app.include_router(db_maintenance_router.router)
    app.include_router(autopilot_router.router)
    app.include_router(vip_router.router)
    app.include_router(contacts_router.router)
    app.include_router(projects_router.router)
    app.include_router(meeting_router.router)
    app.include_router(crm_router.router)
    app.include_router(tracking_router.router)
    app.include_router(tasks_export_router.router)
    app.include_router(webhooks_router.router)
    app.include_router(report_schedule_router.router)
    app.include_router(notify_router.router)
    app.include_router(backup_router.router)
    app.include_router(delegations_router.router)
    app.include_router(overnight_router.router)
    app.include_router(email_rules_router.router)
    app.include_router(voice_router.router)
    app.include_router(signatures_router.router)
    app.include_router(snippets_router.router)
    app.include_router(rag_router.router)
    app.include_router(knowledge_graph_router.router)
    app.include_router(jobs_router.router)
    app.include_router(social_router.router)
    app.include_router(instagram_router.router)
    app.include_router(card_studio_router.router)
    app.include_router(nl_commands_router.router)
    app.include_router(commitments_router.router)
    app.include_router(social_inbox_router.router)
    app.include_router(weather_router.router)
    app.include_router(news_router.router)
    app.include_router(contact_health_router)
    app.include_router(morning_brief_router)
    app.include_router(morning_plan_router)
    app.include_router(calendar_router)
    app.include_router(streak_router.router)
