"""Configuration and toolchain detection. Secrets are read from the environment only."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env", override=False)


def _int_env(name: str, default: int, lo: int, hi: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        value = int(raw) if raw else default
    except ValueError:
        value = default
    return max(lo, min(hi, value))


def _find_java_home() -> Path | None:
    """Locate a JDK 17+ (AGP 8.x requires 17)."""
    candidates: list[Path] = []
    env = os.environ.get("JAVA_HOME", "").strip()
    if env:
        candidates.append(Path(env))
    # macOS JVM paths
    for base in (Path.home() / "Library/Java/JavaVirtualMachines", Path("/Library/Java/JavaVirtualMachines")):
        if base.is_dir():
            candidates.extend(sorted((p / "Contents/Home" for p in base.iterdir()), reverse=True))
    candidates += [
        Path("/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"),
        Path("/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"),
        Path("/Applications/Android Studio.app/Contents/jbr/Contents/Home"),
    ]
    # Windows JVM and Android Studio paths
    win_bases = [
        Path("C:/Program Files/Android/Android Studio/jbr"),
        Path("C:/Program Files (x86)/Android/Android Studio/jbr"),
        Path.home() / "AppData/Local/Android/Android Studio/jbr",
    ]
    for d in (Path("C:/Program Files/Java"), Path("C:/Program Files/Eclipse Adoptium"),
              Path("C:/Program Files/Microsoft"), Path("C:/Program Files/Amazon Corretto"),
              Path("C:/Program Files/Zulu"), Path.home() / "AppData/Local/Programs/Eclipse Adoptium"):
        if d.is_dir():
            try:
                win_bases.extend(sorted((p for p in d.iterdir() if p.is_dir()), reverse=True))
            except OSError:
                pass
    candidates.extend(win_bases)

    # Linux paths
    for base in (Path("/usr/lib/jvm"),):
        if base.is_dir():
            try:
                candidates.extend(sorted((p for p in base.iterdir() if p.is_dir()), reverse=True))
            except OSError:
                pass

    for home in candidates:
        major = java_major_version(home)
        if major is not None and major >= 17:
            return home
    return None


def java_major_version(home: Path) -> int | None:
    java_bin = home / "bin"
    java = java_bin / ("java.exe" if sys.platform == "win32" or not (java_bin / "java").is_file() else "java")
    if not java.is_file():
        if (java_bin / "java.exe").is_file():
            java = java_bin / "java.exe"
        elif (java_bin / "java").is_file():
            java = java_bin / "java"
        else:
            return None
    try:
        out = subprocess.run([str(java), "-version"], capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r'version "(\d+)(?:\.(\d+))?', out.stderr + out.stdout)
    if not m:
        return None
    major = int(m.group(1))
    return int(m.group(2)) if major == 1 and m.group(2) else major


def _find_android_home() -> Path | None:
    for name in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        v = os.environ.get(name, "").strip()
        if v and Path(v).is_dir():
            return Path(v)
    for default in (
        Path.home() / "AppData/Local/Android/Sdk",  # Windows
        Path.home() / "Library/Android/sdk",        # macOS
        Path.home() / "Android/Sdk",                # Linux
    ):
        if default.is_dir():
            return default
    return None


def find_cloudflared() -> str | None:
    found = shutil.which("cloudflared")
    if found:
        return found
    candidates = [
        Path("C:/Program Files (x86)/cloudflared/cloudflared.exe"),
        Path("C:/Program Files/cloudflared/cloudflared.exe"),
        Path.home() / "AppData/Local/Programs/cloudflared/cloudflared.exe",
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    return None


def _str_env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _choice_env(name: str, default: str, choices: set[str]) -> str:
    value = _str_env(name, default).lower()
    return value if value in choices else default


def _list_env(name: str) -> list[str]:
    return [x.strip() for x in os.environ.get(name, "").split(",") if x.strip()]


@dataclass
class Settings:
    root: Path = ROOT
    template_dir: Path = ROOT / "android_template"
    data_dir: Path = ROOT / "data"
    gemini_api_key: str = field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", "").strip(), repr=False)
    gemini_model: str = field(default_factory=lambda: os.environ.get("GEMINI_MODEL", "auto").strip() or "auto")
    # The one AI for chat, apps and websites: gemini (GEMINI_API_KEY), glm (Z.ai, GLM_API_KEY) or groq (GROQ_API_KEY).
    ai_provider: str = field(default_factory=lambda: _choice_env("WEAVE_AI_PROVIDER", "gemini", {"gemini", "glm", "groq"}))
    groq_api_key: str = field(default_factory=lambda: _str_env("GROQ_API_KEY"), repr=False)
    groq_base_url: str = field(default_factory=lambda: _str_env("GROQ_BASE_URL") or "https://api.groq.com/openai/v1")
    groq_model: str = field(default_factory=lambda: _str_env("GROQ_MODEL") or "openai/gpt-oss-120b")
    glm_api_key: str = field(default_factory=lambda: _str_env("GLM_API_KEY"), repr=False)
    glm_base_url: str = field(default_factory=lambda: _str_env("GLM_BASE_URL") or "https://api.z.ai/api/paas/v4")
    glm_model: str = field(default_factory=lambda: _str_env("GLM_MODEL") or "glm-4.7-flash")
    java_home: Path | None = field(default_factory=_find_java_home)
    android_home: Path | None = field(default_factory=_find_android_home)
    build_timeout: int = field(default_factory=lambda: _int_env("WEAVE_BUILD_TIMEOUT_SECONDS", 900, 60, 3600))
    max_repairs: int = field(default_factory=lambda: _int_env("WEAVE_MAX_REPAIR_ATTEMPTS", 2, 0, 2))
    max_concurrent_builds: int = field(default_factory=lambda: _int_env("WEAVE_MAX_CONCURRENT_BUILDS", 1, 1, 4))
    max_queued_builds: int = field(default_factory=lambda: _int_env("WEAVE_MAX_QUEUED_BUILDS", 5, 1, 50))
    host: str = field(default_factory=lambda: os.environ.get("WEAVE_HOST", "127.0.0.1").strip() or "127.0.0.1")
    port: int = field(default_factory=lambda: _int_env("WEAVE_PORT", 8765, 1024, 65535))

    # ---- SMS (Twilio). Secrets are server-side only and never logged or returned by the API. ----
    sms_provider: str = field(default_factory=lambda: _choice_env("WEAVE_SMS_PROVIDER", "twilio", {"twilio", "log", "off"}))
    twilio_account_sid: str = field(default_factory=lambda: _str_env("TWILIO_ACCOUNT_SID"))
    twilio_auth_token: str = field(default_factory=lambda: _str_env("TWILIO_AUTH_TOKEN"), repr=False)
    twilio_phone_number: str = field(default_factory=lambda: _str_env("TWILIO_PHONE_NUMBER"))
    twilio_messaging_service_sid: str = field(default_factory=lambda: _str_env("TWILIO_MESSAGING_SERVICE_SID"))
    # sms, or whatsapp (Twilio API for WhatsApp; same webhooks, addresses prefixed with 'whatsapp:').
    twilio_channel: str = field(default_factory=lambda: _choice_env("TWILIO_CHANNEL", "sms", {"sms", "whatsapp"}))
    # WhatsApp sender in E.164 (the Sandbox is +14155238886). Replies go back on the channel the user wrote in.
    twilio_whatsapp_number: str = field(default_factory=lambda: _str_env("TWILIO_WHATSAPP_NUMBER"))
    # Optional Content template (HX...) whose whole body is {{1}}: WhatsApp replies are sent through it, for senders
    # that refuse free-form Body (error 21654). Create it with `python -m weave sms-whatsapp-template`.
    twilio_whatsapp_content_sid: str = field(default_factory=lambda: _str_env("TWILIO_WHATSAPP_CONTENT_SID"))
    twilio_region: str = field(default_factory=lambda: _str_env("TWILIO_REGION"))
    twilio_edge: str = field(default_factory=lambda: _str_env("TWILIO_EDGE"))

    # ---- Meta WhatsApp Cloud API (Graph API) ----
    whatsapp_provider: str = field(default_factory=lambda: _choice_env("WEAVE_WHATSAPP_PROVIDER", "twilio", {"meta", "twilio", "off"}))
    meta_access_token: str = field(default_factory=lambda: _str_env("META_ACCESS_TOKEN"), repr=False)
    meta_phone_number_id: str = field(default_factory=lambda: _str_env("META_PHONE_NUMBER_ID"))
    meta_business_account_id: str = field(default_factory=lambda: _str_env("META_BUSINESS_ACCOUNT_ID"))
    meta_verify_token: str = field(default_factory=lambda: _str_env("META_VERIFY_TOKEN"), repr=False)
    meta_app_secret: str = field(default_factory=lambda: _str_env("META_APP_SECRET"), repr=False)
    meta_graph_api_version: str = field(default_factory=lambda: _str_env("META_GRAPH_API_VERSION", "v21.0") or "v21.0")
    # Externally visible https origin that Twilio calls (used for signature validation and download links).
    public_base_url: str = field(default_factory=lambda: _str_env("PUBLIC_BASE_URL").rstrip("/"))
    # closed: only WEAVE_SMS_OWNER_NUMBERS; link: others must text LINK <one-time code>; open: anyone gets an isolated guest account.
    # account: numbers must belong to an askweave.xyz account (sign up on the site, then text LINK <code>).
    sms_signup: str = field(default_factory=lambda: _choice_env("WEAVE_SMS_SIGNUP", "link", {"closed", "link", "open", "account"}))
    # Referrals: users text INVITE for a code; friends text JOIN <code> to get a guest account (works in link mode too).
    sms_referrals: bool = field(default_factory=lambda: _choice_env("WEAVE_SMS_REFERRALS", "on", {"on", "off"}) == "on")
    sms_referral_bonus: int = field(default_factory=lambda: _int_env("WEAVE_SMS_REFERRAL_BONUS", 2, 0, 50))
    sms_referral_max: int = field(default_factory=lambda: _int_env("WEAVE_SMS_REFERRAL_MAX", 20, 0, 1000))
    # Accounts (askweave.xyz sign-up). Google sign-in shows only when both are set.
    google_client_id: str = field(default_factory=lambda: _str_env("GOOGLE_CLIENT_ID"))
    google_client_secret: str = field(default_factory=lambda: _str_env("GOOGLE_CLIENT_SECRET"), repr=False)
    user_storage_mb: int = field(default_factory=lambda: _int_env("WEAVE_USER_STORAGE_MB", 50, 1, 10_000))
    max_projects: int = field(default_factory=lambda: _int_env("WEAVE_MAX_PROJECTS", 25, 1, 1000))
    trash_days: int = field(default_factory=lambda: _int_env("WEAVE_TRASH_DAYS", 30, 1, 365))
    sms_owner_numbers: list[str] = field(default_factory=lambda: _list_env("WEAVE_SMS_OWNER_NUMBERS"))
    sms_default_country_code: str = field(default_factory=lambda: _str_env("WEAVE_SMS_DEFAULT_COUNTRY_CODE", "+1"))
    sms_worker: str = field(default_factory=lambda: _choice_env("WEAVE_SMS_WORKER", "embedded", {"embedded", "external"}))
    sms_daily_builds_member: int = field(default_factory=lambda: _int_env("WEAVE_SMS_DAILY_BUILDS", 20, 1, 1000))
    sms_daily_builds_guest: int = field(default_factory=lambda: _int_env("WEAVE_SMS_GUEST_DAILY_BUILDS", 3, 0, 100))
    sms_inbound_per_hour: int = field(default_factory=lambda: _int_env("WEAVE_SMS_INBOUND_PER_HOUR", 30, 5, 1000))
    sms_max_queued: int = field(default_factory=lambda: _int_env("WEAVE_SMS_MAX_QUEUED", 20, 1, 500))
    sms_job_max_attempts: int = field(default_factory=lambda: _int_env("WEAVE_SMS_JOB_MAX_ATTEMPTS", 3, 1, 10))
    sms_progress: str = field(default_factory=lambda: _choice_env("WEAVE_SMS_PROGRESS", "major", {"all", "major", "off"}))
    sms_progress_min_interval: int = field(default_factory=lambda: _int_env("WEAVE_SMS_PROGRESS_MIN_INTERVAL_SECONDS", 60, 0, 3600))
    sms_link_ttl_hours: int = field(default_factory=lambda: _int_env("WEAVE_SMS_LINK_TTL_HOURS", 72, 1, 720))
    # Chat brain: plain-language conversation through the AI (GLM or Gemini). off = rules only.
    chat_brain: bool = field(default_factory=lambda: _choice_env("WEAVE_CHAT_BRAIN", "on", {"on", "off"}) == "on")
    chat_timeout: int = field(default_factory=lambda: _int_env("WEAVE_CHAT_TIMEOUT_SECONDS", 60, 5, 600))
    # Model for chat replies with WEAVE_AI_PROVIDER=gemini (empty = GEMINI_MODEL). With glm/groq it is their model.
    chat_model: str = field(default_factory=lambda: _str_env("WEAVE_CHAT_MODEL", "gemini-3.5-flash-lite"))
    # Chat replies for different people are worked out at the same time (each person's messages stay in order).
    chat_workers: int = field(default_factory=lambda: _int_env("WEAVE_CHAT_WORKERS", 16, 1, 64))
    # Natural Language Generation (NLG): rephrases factual results conversationally. off = deterministic only.
    nlg_enabled: bool = field(default_factory=lambda: _choice_env("WEAVE_NLG", "on", {"on", "off"}) == "on")
    nlg_timeout: int = field(default_factory=lambda: _int_env("WEAVE_NLG_TIMEOUT_SECONDS", 12, 2, 60))
    nlg_model: str = field(default_factory=lambda: _str_env("WEAVE_NLG_MODEL", "gemini-3.5-flash-lite"))
    # Visits to hosted customer sites, counted by us. No cookies, no third party, no IP or user agent stored.
    analytics: bool = field(default_factory=lambda: _choice_env("WEAVE_ANALYTICS", "on", {"on", "off"}) == "on")
    analytics_flush_seconds: int = field(default_factory=lambda: _int_env("WEAVE_ANALYTICS_FLUSH_SECONDS", 10, 1, 120))
    analytics_raw_days: int = field(default_factory=lambda: _int_env("WEAVE_ANALYTICS_RAW_DAYS", 35, 1, 400))
    analytics_rollup_days: int = field(default_factory=lambda: _int_env("WEAVE_ANALYTICS_ROLLUP_DAYS", 400, 30, 3650))
    # On behind a reverse proxy (our Cloudflare tunnel): take the visitor's address from CF-Connecting-IP or
    # X-Forwarded-For. Off on a proxy, every visitor looks like the proxy and the visitor count collapses to 1.
    trust_proxy: bool = field(default_factory=lambda: _choice_env("WEAVE_TRUST_PROXY", "off", {"on", "off"}) == "on")
    # Storage durability. The database is one file; if the disk under it is thrown away on redeploy,
    # everything goes with it. See weave/safety.py.
    require_existing_data: bool = field(default_factory=lambda: _choice_env(
        "WEAVE_REQUIRE_EXISTING_DATA", "off", {"on", "off"}) == "on")
    init_data: bool = field(default_factory=lambda: _choice_env("WEAVE_INIT_DATA", "off", {"on", "off"}) == "on")
    backup_upload: str = field(default_factory=lambda: os.environ.get("WEAVE_BACKUP_UPLOAD", "").strip())
    backup_keep: int = field(default_factory=lambda: _int_env("WEAVE_BACKUP_KEEP", 7, 1, 90))
    # Voice notes (WhatsApp/MMS audio) are transcribed locally with Whisper. Models: tiny | base | small | medium.
    voice_enabled: bool = field(default_factory=lambda: _choice_env("WEAVE_VOICE", "on", {"on", "off"}) == "on")
    voice_model: str = field(default_factory=lambda: _choice_env(
        "WEAVE_VOICE_MODEL", "base", {"tiny", "base", "small", "medium", "tiny.en", "base.en", "small.en"}))
    voice_language: str = field(default_factory=lambda: _str_env("WEAVE_VOICE_LANGUAGE", ""))  # "" = auto-detect

    # ---- Website builder: weave's generator (adityapokuri229/weave, src/portfolio/) run through weave/web/bridge.mjs ----
    # Path to an unmodified weave checkout. Empty = the website builder is unavailable.
    website_engine_dir: str = field(default_factory=lambda: _str_env("WEAVE_WEBSITE_ENGINE_DIR"))
    website_builder: bool = field(default_factory=lambda: _choice_env("WEAVE_WEBSITE_BUILDER", "on", {"on", "off"}) == "on")
    node_bin: str = field(default_factory=lambda: _str_env("WEAVE_NODE_BIN") or shutil.which("node") or "")
    # Design options generated per new website (each is one more large Gemini call).
    website_variants: int = field(default_factory=lambda: _int_env("WEAVE_WEBSITE_VARIANTS", 1, 1, 3))
    # Ask the user's style preferences (numbered choices, colours, or "skip") before designing a new website.
    website_ask_style: bool = field(default_factory=lambda: _choice_env("WEAVE_WEBSITE_ASK_STYLE", "on", {"on", "off"}) == "on")
    # Website builds mostly wait on Gemini, so several run at once; Android builds stay CPU-bound
    # (WEAVE_MAX_CONCURRENT_BUILDS).
    # How much Gemini "thinks" before writing a page: low (fast), minimal (fastest), or default (slowest).
    website_thinking: str = field(default_factory=lambda: _choice_env("WEAVE_WEBSITE_THINKING", "low", {"low", "minimal", "default"}))
    website_workers: int = field(default_factory=lambda: _int_env("WEAVE_WEBSITE_WORKERS", 4, 1, 16))
    # Extra pages (about, contact, ...) added to each new website; 0 = one-page sites. Each is one more Gemini call.
    website_pages: int = field(default_factory=lambda: _int_env("WEAVE_WEBSITE_PAGES", 3, 0, 4))
    website_timeout: int = field(default_factory=lambda: _int_env("WEAVE_WEBSITE_TIMEOUT_SECONDS", 1200, 60, 3600))
    # Publishing: off | netlify (owner approves each PUBLISH; needs a token) |
    # weave (every finished website goes live at https://<name>.<WEAVE_SITES_DOMAIN>/, served by this server).
    website_deploy: str = field(default_factory=lambda: _choice_env("WEAVE_WEBSITE_DEPLOY", "off", {"off", "netlify", "weave"}))
    sites_domain: str = field(default_factory=lambda: _str_env("WEAVE_SITES_DOMAIN").lower().strip("."))
    netlify_auth_token: str = field(default_factory=lambda: _str_env("NETLIFY_AUTH_TOKEN"), repr=False)

    @property
    def builds_dir(self) -> Path:
        return self.data_dir / "builds"

    @property
    def sites_dir(self) -> Path:
        return self.data_dir / "sites"

    @property
    def hosted_dir(self) -> Path:
        return self.data_dir / "hosted"

    @property
    def user_sites_dir(self) -> Path:
        """Sites of account holders: <user_sites_dir>/<username>/<project slug>/."""
        return self.data_dir / "hosted-users"

    @property
    def trash_dir(self) -> Path:
        """Deleted projects, restorable until purged after WEAVE_TRASH_DAYS."""
        return self.data_dir / "hosted-trash"

    @property
    def gradle_user_home(self) -> Path:
        return self.data_dir / "gradle-home"

    @property
    def sms_db_path(self) -> Path:
        return self.data_dir / "sms.sqlite3"

    @property
    def whatsapp_sender(self) -> str:
        if self.twilio_whatsapp_number:
            return self.twilio_whatsapp_number
        return self.twilio_phone_number if self.twilio_channel == "whatsapp" else ""

    @property
    def sms_sender(self) -> str:
        return "" if self.twilio_channel == "whatsapp" and not self.twilio_whatsapp_number else self.twilio_phone_number

    @property
    def sms_enabled(self) -> bool:
        """An external messaging channel (Twilio SMS/WhatsApp, Meta WhatsApp, or the log provider) is configured."""
        if self.sms_provider == "log":
            return True
        if self.whatsapp_provider == "meta" and bool(self.meta_access_token and self.meta_phone_number_id):
            return True
        return (self.sms_provider == "twilio" and bool(self.twilio_account_sid and self.twilio_auth_token)
                and bool(self.twilio_phone_number or self.twilio_whatsapp_number or self.twilio_messaging_service_sid))

    def __post_init__(self) -> None:
        if self.website_engine_dir and not Path(self.website_engine_dir).expanduser().is_absolute():
            # "../website-engine" means next to server/, wherever the server was started from (the bridge runs
            # in its own sandbox folder, so a relative path would point nowhere).
            self.website_engine_dir = str((ROOT / self.website_engine_dir).resolve())
        if (api := self.compat_api) is not None:
            # One model for everything (chat, apps, websites). There is no fallback to another model.
            self.gemini_model = self.chat_model = self.nlg_model = api["model"]

    @property
    def compat_api(self) -> dict | None:
        """The OpenAI-style chat-completions endpoint for glm and groq (None for gemini): key, base URL, model, and the
        provider's own body fields (thinking/reasoning switched down so replies come back in seconds)."""
        if self.ai_provider == "glm":
            # OpenRouter's GLM models must reason; "low" keeps that short. Z.ai's own API can switch it off.
            extra = ({"reasoning": {"effort": "low"}} if "openrouter.ai" in self.glm_base_url
                     else {"thinking": {"type": "disabled"}})
            return {"key": self.glm_api_key, "base_url": self.glm_base_url, "model": self.glm_model, "extra": extra}
        if self.ai_provider == "groq":
            return {"key": self.groq_api_key, "base_url": self.groq_base_url, "model": self.groq_model,
                    "extra": {"reasoning_effort": "low"} if self.groq_model.startswith("openai/gpt-oss") else {}}
        return None

    @property
    def ai_key(self) -> str:
        api = self.compat_api
        return api["key"] if api is not None else self.gemini_api_key

    def sms_issues(self) -> list[str]:
        """Configuration problems that stop the messaging channels from working (names only, never values)."""
        if self.sms_provider == "off" and self.whatsapp_provider == "off":
            return ["WEAVE_SMS_PROVIDER=off", "WEAVE_WHATSAPP_PROVIDER=off"]
        issues = []
        if self.whatsapp_provider == "meta":
            if not self.meta_access_token:
                issues.append("META_ACCESS_TOKEN is missing")
            if not self.meta_phone_number_id:
                issues.append("META_PHONE_NUMBER_ID is missing")
        if self.sms_provider == "twilio":
            if not self.twilio_account_sid.startswith("AC"):
                issues.append("TWILIO_ACCOUNT_SID is missing or does not start with AC")
            if not self.twilio_auth_token:
                issues.append("TWILIO_AUTH_TOKEN is missing")
            if not (self.twilio_phone_number or self.twilio_whatsapp_number or self.twilio_messaging_service_sid):
                issues.append("set TWILIO_WHATSAPP_NUMBER (WhatsApp), TWILIO_PHONE_NUMBER (SMS) or TWILIO_MESSAGING_SERVICE_SID")
        if not self.public_base_url.startswith("https://"):
            issues.append("PUBLIC_BASE_URL must be the public https:// URL that forwards to Weave")
        return issues

    def build_tools_dir(self) -> Path | None:
        if not self.android_home:
            return None
        bt = self.android_home / "build-tools"
        if not bt.is_dir():
            return None
        versions = sorted((p for p in bt.iterdir() if p.is_dir()), key=lambda p: [int(x) if x.isdigit() else 0 for x in re.split(r"[.-]", p.name)])
        return versions[-1] if versions else None

    def doctor(self) -> dict:
        """Report prerequisites without revealing secrets."""
        checks = []

        def add(name: str, ok: bool, detail: str, fix: str = "") -> None:
            checks.append({"name": name, "ok": ok, "detail": detail, "fix": "" if ok else fix})

        # Python dependencies
        missing_deps = []
        for mod, pkg in (("fastapi", "fastapi"), ("uvicorn", "uvicorn"), ("pydantic", "pydantic"), ("dotenv", "python-dotenv")):
            try:
                __import__(mod)
            except ImportError:
                missing_deps.append(pkg)
        try:
            __import__("google.genai")
        except ImportError:
            missing_deps.append("google-genai")
        if self.voice_enabled:
            try:
                __import__("faster_whisper")
            except ImportError:
                missing_deps.append("faster-whisper")
        add("Python dependencies", not missing_deps,
            "all required packages installed" if not missing_deps else f"missing packages: {', '.join(missing_deps)}",
            "Run: pip install -r requirements.txt")

        key_name = {"glm": "GLM_API_KEY", "groq": "GROQ_API_KEY"}.get(self.ai_provider, "GEMINI_API_KEY")
        add("AI API key", bool(self.ai_key),
            f"{key_name} is set ({self.ai_provider}, model {self.gemini_model})" if self.ai_key else f"{key_name} is missing",
            f"Put {key_name}=... in .env (WEAVE_AI_PROVIDER={self.ai_provider})")

        if self.whatsapp_provider == "meta":
            meta_missing = []
            if not self.meta_access_token:
                meta_missing.append("META_ACCESS_TOKEN")
            if not self.meta_phone_number_id:
                meta_missing.append("META_PHONE_NUMBER_ID")
            if not self.meta_verify_token:
                meta_missing.append("META_VERIFY_TOKEN")
            if not self.meta_app_secret:
                meta_missing.append("META_APP_SECRET")
            add("Meta WhatsApp", not meta_missing,
                f"configured (phone number ID: {self.meta_phone_number_id})" if not meta_missing else f"missing: {', '.join(meta_missing)}",
                "Set META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_VERIFY_TOKEN, and META_APP_SECRET in .env")
        elif self.whatsapp_provider == "twilio" or self.sms_provider == "twilio":
            tw_issues = [i for i in self.sms_issues() if not i.startswith("PUBLIC_BASE_URL")]
            add("Twilio configuration", not tw_issues,
                "Twilio credentials configured" if not tw_issues else f"issues: {'; '.join(tw_issues)}",
                "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO phone number in .env")

        pub_ok = bool(self.public_base_url and self.public_base_url.startswith("https://"))
        add("Public URL", pub_ok,
            self.public_base_url if pub_ok else ("PUBLIC_BASE_URL is not set" if not self.public_base_url else "PUBLIC_BASE_URL must begin with https://"),
            "Start via scripts/run_prod.sh (or scripts/weave_public.sh for a temporary URL), or set PUBLIC_BASE_URL")

        cf = find_cloudflared()
        add("Cloudflare tunnel", cf is not None,
            f"cloudflared available at {cf}" if cf else "cloudflared not found",
            "Install cloudflared (winget install Cloudflare.cloudflared or brew install cloudflared)")

        major = java_major_version(self.java_home) if self.java_home else None
        add("JDK 17+", major is not None and major >= 17,
            f"Java {major} at {self.java_home}" if major else "No JDK 17+ found",
            "Install a JDK 17 (e.g. Eclipse Temurin 17 or Android Studio jbr) and set JAVA_HOME in .env")
        add("Android SDK", self.android_home is not None,
            str(self.android_home) if self.android_home else "Android SDK not found",
            "Install Android cmdline-tools and set ANDROID_HOME in .env")
        platform_ok = bool(self.android_home and (self.android_home / "platforms/android-35").is_dir())
        add("Android platform 35", platform_ok, "platforms;android-35 installed" if platform_ok else "platforms;android-35 missing",
            'Run: sdkmanager "platforms;android-35" "build-tools;35.0.0"')
        licenses_ok = bool(self.android_home and (self.android_home / "licenses/android-sdk-license").is_file())
        add("Android SDK license", licenses_ok, "accepted" if licenses_ok else "not accepted",
            "Run: sdkmanager --licenses")
        wrapper_ok = ((self.template_dir / "gradlew").is_file() or (self.template_dir / "gradlew.bat").is_file()) and (self.template_dir / "gradle/wrapper/gradle-wrapper.jar").is_file()
        add("Gradle wrapper", wrapper_ok, "template wrapper present" if wrapper_ok else "android_template/gradlew or gradlew.bat missing",
            "Restore android_template/gradlew, gradlew.bat and gradle/wrapper from git")

        # Behind the tunnel every request arrives from localhost, so without the proxy header every visitor
        # hashes alike and each day's visitor count is 1. Counting still works; the number is just wrong.
        proxy_ok = self.trust_proxy or not pub_ok
        add("Site analytics", proxy_ok,
            ("off (WEAVE_ANALYTICS=off)" if not self.analytics else
             f"counting visits, raw views kept {self.analytics_raw_days} days"
             + ("" if self.trust_proxy else ", direct connections")),
            "Set WEAVE_TRUST_PROXY=on: behind a proxy, visitor counts collapse to 1 per day without it")

        # Where the data lives. The one check here that can fail silently in production and lose everything.
        from .safety import storage_report

        store = storage_report(self)
        durable = not store["ephemeral"]
        add("Data directory", durable,
            f"{store['data_dir']} on {store['fstype'] or 'an unknown filesystem'}"
            + ("" if store["db_exists"] else ", no database yet"),
            f"That is a container filesystem wiped on every redeploy - every account, site and enquiry "
            f"would be lost. Mount a persistent volume and point WEAVE_DATA_DIR at it.")
        add("Backups", bool(self.backup_upload),
            (f"copied off this machine ({self.backup_upload.split()[0]})" if self.backup_upload
             else f"daily, kept {self.backup_keep}, in {store['data_dir']}/backups"),
            "Backups sit on the same disk as the database, so a lost disk loses both. "
            "Set WEAVE_BACKUP_UPLOAD to a command that copies a file somewhere else.")

        core_checks = [c for c in checks if c["name"] in ("AI API key", "JDK 17+", "Android SDK", "Android platform 35", "Android SDK license", "Gradle wrapper")]
        return {"ready": all(c["ok"] for c in core_checks), "checks": checks}

    def website_problem(self) -> str:
        """Why the website builder cannot run (empty when it can). Kept out of doctor(), which gates Android builds."""
        if not self.website_builder:
            return "the website builder is switched off (WEAVE_WEBSITE_BUILDER=off)"
        if not self.website_engine_dir:
            return "no website engine is configured (WEAVE_WEBSITE_ENGINE_DIR)"
        engine = Path(self.website_engine_dir).expanduser()
        if not (engine / "src/portfolio/bespokeHtmlGenerator.js").is_file():
            return f"the website engine was not found at {engine} (expected a weave checkout with src/portfolio/)"
        if not self.node_bin or not Path(self.node_bin).is_file():
            return "Node.js was not found (install Node 20+ or set WEAVE_NODE_BIN)"
        if not self.ai_key:
            return f"no AI key is set for WEAVE_AI_PROVIDER={self.ai_provider}"
        return ""

    def website_doctor(self) -> list[dict]:
        problem = self.website_problem()
        checks = [{"name": "Website builder", "ok": not problem,
                   "detail": problem or f"weave engine at {Path(self.website_engine_dir).expanduser()}",
                   "fix": "" if not problem else "See README: Website builder"}]
        if self.website_deploy == "weave":
            checks.append({"name": "Website publishing", "ok": bool(self.sites_domain),
                           "detail": f"Weave hosting: every website goes live at https://<name>.{self.sites_domain}/"
                                     if self.sites_domain else "WEAVE_SITES_DOMAIN is not set",
                           "fix": "" if self.sites_domain else "Set WEAVE_SITES_DOMAIN (e.g. weave.xyz) and point *.domain at this server"})
            return checks
        publish = self.website_deploy == "netlify" and bool(self.netlify_auth_token)
        checks.append({"name": "Website publishing", "ok": True,
                       "detail": "Netlify (owner approval per publish)" if publish else
                                 "off: websites get private previews only (set WEAVE_WEBSITE_DEPLOY=netlify and NETLIFY_AUTH_TOKEN)",
                       "fix": ""})
        return checks


settings = Settings()

