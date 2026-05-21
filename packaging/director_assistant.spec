# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Director Assistant
# Build: pyinstaller packaging/director_assistant.spec

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = Path(SPECPATH).parent          # repo root
BACKEND = ROOT / "backend"
STATIC  = BACKEND / "static"         # pre-built frontend

block_cipher = None

# Collect non-Python data files for packages that use importlib_resources
chromadb_datas  = collect_data_files("chromadb")
tokenizer_datas = collect_data_files("tokenizers")
st_datas        = collect_data_files("sentence_transformers")

a = Analysis(
    [str(ROOT / "packaging" / "launcher.py")],
    pathex=[str(BACKEND)],
    binaries=[],
    datas=[
        # Frontend static build
        (str(STATIC), "static"),
        # Backend Python source (routers, services, models)
        (str(BACKEND / "routers"),  "routers"),
        (str(BACKEND / "services"), "services"),
        (str(BACKEND / "models"),   "models"),
        (str(BACKEND / "main.py"),  "."),
        (str(BACKEND / "models.py"), "."),
        # Package data files (SQL migrations, tokenizer configs, etc.)
        *chromadb_datas,
        *tokenizer_datas,
        *st_datas,
    ],
    hiddenimports=[
        # FastAPI / uvicorn
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "fastapi",
        "fastapi.middleware.cors",
        "fastapi.staticfiles",
        "starlette.middleware",
        "starlette.routing",
        # ChromaDB — explicit list because many subdirs lack __init__.py
        # preventing collect_submodules from finding them
        "chromadb",
        "chromadb.api",
        "chromadb.api.async_api",
        "chromadb.api.async_client",
        "chromadb.api.async_fastapi",
        "chromadb.api.base_http_client",
        "chromadb.api.client",
        "chromadb.api.configuration",
        "chromadb.api.fastapi",
        "chromadb.api.models.AsyncCollection",
        "chromadb.api.models.Collection",
        "chromadb.api.models.CollectionCommon",
        "chromadb.api.segment",
        "chromadb.api.shared_system_client",
        "chromadb.api.types",
        "chromadb.app",
        "chromadb.auth",
        "chromadb.auth.basic_authn",
        "chromadb.auth.simple_rbac_authz",
        "chromadb.auth.token_authn",
        "chromadb.config",
        "chromadb.db",
        "chromadb.db.base",
        "chromadb.db.impl",
        "chromadb.db.impl.sqlite",
        "chromadb.db.impl.sqlite_pool",
        "chromadb.db.migrations",
        "chromadb.db.mixins.embeddings_queue",
        "chromadb.db.mixins.sysdb",
        "chromadb.db.system",
        "chromadb.errors",
        "chromadb.execution",
        "chromadb.execution.executor.abstract",
        "chromadb.execution.executor.local",
        "chromadb.execution.expression.operator",
        "chromadb.execution.expression.plan",
        "chromadb.ingest",
        "chromadb.ingest.impl.utils",
        "chromadb.migrations",
        "chromadb.quota",
        "chromadb.quota.test_provider",
        "chromadb.rate_limit",
        "chromadb.rate_limit.simple_rate_limit",
        "chromadb.segment",
        "chromadb.segment.impl",
        "chromadb.segment.impl.manager",
        "chromadb.segment.impl.manager.cache",
        "chromadb.segment.impl.manager.cache.cache",
        "chromadb.segment.impl.manager.local",
        "chromadb.segment.impl.metadata.sqlite",
        "chromadb.segment.impl.vector.batch",
        "chromadb.segment.impl.vector.brute_force_index",
        "chromadb.segment.impl.vector.hnsw_params",
        "chromadb.segment.impl.vector.local_hnsw",
        "chromadb.segment.impl.vector.local_persistent_hnsw",
        "chromadb.serde",
        "chromadb.telemetry",
        "chromadb.telemetry.opentelemetry",
        "chromadb.telemetry.opentelemetry.fastapi",
        "chromadb.telemetry.product",
        "chromadb.telemetry.product.events",
        "chromadb.telemetry.product.posthog",
        "chromadb.types",
        "chromadb.utils",
        "chromadb.utils.async_to_sync",
        "chromadb.utils.batch_utils",
        "chromadb.utils.data_loaders",
        "chromadb.utils.delete_file",
        "chromadb.utils.directory",
        "chromadb.utils.distance_functions",
        "chromadb.utils.embedding_functions",
        "chromadb.utils.embedding_functions.onnx_mini_lm_l6_v2",
        "chromadb.utils.embedding_functions.sentence_transformer_embedding_function",
        "chromadb.utils.embedding_functions.openai_embedding_function",
        "chromadb.utils.fastapi",
        "chromadb.utils.lru_cache",
        "chromadb.utils.messageid",
        "chromadb.utils.read_write_lock",
        "chromadb.utils.rendezvous_hash",
        "hnswlib",
        "posthog",
        "overrides",
        "importlib_resources",
        # Sentence transformers / ML
        "sentence_transformers",
        "torch",
        "transformers",
        "tokenizers",
        "huggingface_hub",
        "sklearn",
        "numpy",
        # Anthropic / OpenAI
        "anthropic",
        "openai",
        "httpx",
        # Email / MSAL
        "msal",
        "imaplib",
        "email",
        "email.mime",
        "email.mime.text",
        "email.mime.multipart",
        # Document parsing
        "pdfminer",
        "pdfminer.high_level",
        "docx",
        "openpyxl",
        # Misc
        "keyring",
        "dotenv",
        "aiofiles",
        "multipart",
        "pydantic",
        "sqlalchemy",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "matplotlib",
        "IPython",
        "jupyter",
        "notebook",
        "pytest",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="DirectorAssistant",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon=str(ROOT / "packaging" / "icon.icns"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="DirectorAssistant",
)

# macOS .app bundle
if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="Director Assistant.app",
        icon=str(ROOT / "packaging" / "icon.icns"),
        bundle_identifier="com.director-assistant.app",
        info_plist={
            "NSHighResolutionCapable": True,
            "CFBundleShortVersionString": "2.7.0",
            "CFBundleVersion": "2.7.0",
            "LSMinimumSystemVersion": "12.0",
            "NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True},
        },
    )
