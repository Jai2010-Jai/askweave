from dataclasses import dataclass
from pathlib import Path

import pytest

from weave.config import ROOT, Settings
from weave.core.builder import AndroidBuilder, ApkInfo, BuildError, GradleResult
from weave.core.gemini import GeminiError
from weave.core.schemas import AppManifest, GeneratedFile, RepairPatch, ThemeMode

GOOD = """package com.weave.app

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.weave.app.ui.kit.Spacing

@Composable
fun WeaveApp() {
    Text("ok")
}
"""
BROKEN = GOOD.replace('Text("ok")', 'Txt("ok")')


class ReadySettings(Settings):
    def doctor(self) -> dict:
        return {"ready": True, "checks": []}


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    s = ReadySettings(data_dir=tmp_path / "data", template_dir=ROOT / "android_template",
                      gemini_api_key="test-key-not-real", research_model="", java_home=tmp_path, android_home=tmp_path,
                      ai_provider="gemini")  # never the real GLM key from .env
    s.max_repairs = 2
    # Never use real Twilio credentials from .env in tests: outbound SMS go to a fake provider.
    s.sms_provider = "log"
    s.website_ask_style = False  # tests that want the style question turn it on
    s.twilio_account_sid = "AC" + "0" * 32
    s.twilio_auth_token = "test-auth-token"
    s.twilio_phone_number = "+15005550006"
    s.twilio_messaging_service_sid = ""
    s.twilio_channel = "sms"
    s.twilio_whatsapp_number = "+14155238886"
    s.twilio_whatsapp_content_sid = ""
    s.whatsapp_provider = "twilio"
    s.public_base_url = "https://weave.example.test"
    s.sms_owner_numbers = ["+919876500001"]
    s.sms_signup = "link"
    s.sms_progress = "all"
    s.sms_progress_min_interval = 0
    # Never use a website engine, Netlify token or Gemini model setting from .env in tests.
    s.gemini_model = "auto"
    s.website_engine_dir = ""
    s.website_deploy = "off"
    s.netlify_auth_token = ""
    s.website_variants = 1
    return s


def manifest(content: str = GOOD, **kw) -> AppManifest:
    data = dict(app_name="Lift Log", package_id="com.weave.liftlog", category="workout_tracker",
                description="Track lifts", features=["log sets"], primary_color="#7C4DFF",
                files=[{"path": "WeaveApp.kt", "content": content}])
    data.update(kw)
    return AppManifest.model_validate(data)


class FakeGemini:
    def __init__(self, first: AppManifest | Exception, repairs: list[str] | None = None,
                 errors: list[Exception] | None = None):
        self.first = first
        self.repairs = list(repairs or [])
        self.repair_calls = 0
        self.errors = list(errors or [])  # raised (once each) by the next generate/modify calls
        self.prompts: list[str] = []
        self.modify_calls: list[tuple[str, dict, AppManifest]] = []

    def generate_app(self, prompt, app_name):
        self.prompts.append(prompt)
        if self.errors:
            raise self.errors.pop(0)
        if isinstance(self.first, Exception):
            raise self.first
        return self.first.model_copy(deep=True), {"model": "fake"}

    def modify_app(self, change, files, base):
        self.modify_calls.append((change, files, base))
        if self.errors:
            raise self.errors.pop(0)
        updated = base.model_copy(deep=True)
        updated.package_id = "com.weave.changedbymodel"  # the orchestrator must restore the base package
        updated.theme_mode = ThemeMode.dark if "dark" in change.lower() else updated.theme_mode
        updated.features = updated.features + [change[:50]]
        updated.files = [GeneratedFile(path=p, content=c) for p, c in files.items()]
        return updated, {"model": "fake"}

    def repair(self, diagnostics, files, manifest):
        self.repair_calls += 1
        if not self.repairs:
            raise GeminiError("no more repairs")
        return RepairPatch(explanation="fixed Txt", files=[GeneratedFile(path="WeaveApp.kt", content=self.repairs.pop(0))]), {"model": "fake"}


@dataclass
class FakeBuilder(AndroidBuilder):
    """Real workspace handling; Gradle and APK checks are simulated from the source contents."""

    def __init__(self, settings):
        super().__init__(settings)
        self.runs = 0

    def run_gradle(self, workspace, log_path, on_line=None, task="assembleDebug", cancel=None):
        self.runs += 1
        src = (workspace / "app/src/main/java/com/weave/app/WeaveApp.kt").read_text()
        if "Txt(" in src:
            out = (f"e: file://{workspace}/app/src/main/java/com/weave/app/WeaveApp.kt:8:5 Unresolved reference 'Txt'.\n"
                   "BUILD FAILED\n")
            return GradleResult(1, out, False, 0.1)
        if "TOOLCHAIN_BOOM" in src:
            return GradleResult(1, "* What went wrong:\nCould not resolve com.android.tools.build:gradle\n* Try:\n", False, 0.1)
        apk = workspace / "app/build/outputs/apk/debug/app-debug.apk"
        apk.parent.mkdir(parents=True, exist_ok=True)
        apk.write_bytes(b"PK fake apk")
        return GradleResult(0, "BUILD SUCCESSFUL\n", False, 0.1)

    def verify_apk(self, workspace, expected_package):
        apk = workspace / "app/build/outputs/apk/debug/app-debug.apk"
        if not apk.is_file():
            raise BuildError("missing")
        return ApkInfo(apk, apk.stat().st_size, expected_package, True, ["fake check"])
