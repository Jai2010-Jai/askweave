import pytest
from pydantic import ValidationError as PydanticValidationError

from weave.core.schemas import AppManifest, BuildRequest, GeneratedFile, RepairPatch
from weave.core.validation import (
    MAX_FILE_BYTES,
    ValidationError,
    normalize_rel_path,
    validate_file,
    validate_manifest,
    validate_patch,
)

ENTRY = """package com.weave.app

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import com.weave.app.ui.kit.Spacing

@Composable
fun WeaveApp() {
    Text("hi")
}
"""


def manifest(**overrides):
    data = dict(
        app_name="Test App", package_id="com.weave.testapp", category="todo_list",
        description="A test", features=["a"], primary_color="#112233",
        files=[{"path": "WeaveApp.kt", "content": ENTRY}],
    )
    data.update(overrides)
    return AppManifest.model_validate(data)


# ---------- paths ----------
@pytest.mark.parametrize("bad", [
    "../evil.kt", "ui/../../evil.kt", "/etc/passwd.kt", "C:/x.kt", "..\\x.kt", "a/./b.kt",
    "build.gradle.kts", "app/build.gradle.kts", "AndroidManifest.xml", "res/values/strings.xml",
    "script.sh", "Foo.java", "Foo.kt.exe", "", "ui/Theme/X.kt", "a/b/c/d/E.kt", "x\x00.kt",
    "MainActivity.kt", "ui/theme/Theme.kt", "ui/theme/ThemeConfig.kt", "ui/kit/Kit.kt", "ui/kit/Extra.kt", "1Bad.kt",
])
def test_rejects_bad_paths(bad):
    with pytest.raises(ValidationError):
        normalize_rel_path(bad)


@pytest.mark.parametrize("raw,expected", [
    ("WeaveApp.kt", "WeaveApp.kt"),
    ("ui/HomeScreen.kt", "ui/HomeScreen.kt"),
    ("app/src/main/java/com/weave/app/data/Store.kt", "data/Store.kt"),
    ("com/weave/app/data/Store.kt", "data/Store.kt"),
])
def test_accepts_and_normalizes_paths(raw, expected):
    assert normalize_rel_path(raw) == expected


# ---------- content ----------
def test_package_must_match_directory():
    with pytest.raises(ValidationError, match="package com.weave.app.data"):
        validate_file(GeneratedFile(path="data/Store.kt", content="package com.weave.app\n"))
    assert validate_file(GeneratedFile(path="data/Store.kt", content="package com.weave.app.data\nclass Store\n"))


@pytest.mark.parametrize("snippet", [
    'val p = Runtime.getRuntime().exec("ls")',
    "val pb = ProcessBuilder()",
    "import java.net.URL",
    "val c = Class.forName(\"x\")",
    "System.loadLibrary(\"x\")",
    "external fun nativeThing(): Int",
    "import okhttp3.OkHttpClient",
    "import com.squareup.picasso.Picasso",
    "val w = WebView(ctx)",
])
def test_forbidden_apis(snippet):
    code = f"package com.weave.app\n{snippet}\n"
    with pytest.raises(ValidationError, match="disallowed API"):
        validate_file(GeneratedFile(path="X.kt", content=code))


def test_forbidden_words_in_comments_and_strings_are_fine():
    code = 'package com.weave.app\n// uses no ProcessBuilder\nval s = "Runtime.getRuntime() is not used"\n'
    validate_file(GeneratedFile(path="X.kt", content=code))


def test_file_size_limit():
    big = "package com.weave.app\n" + "// x\n" * (MAX_FILE_BYTES // 4)
    with pytest.raises(ValidationError, match="limit"):
        validate_file(GeneratedFile(path="X.kt", content=big))


def test_manifest_requires_entry_point():
    m = manifest(files=[{"path": "Other.kt", "content": "package com.weave.app\nfun x() {}\n"}])
    with pytest.raises(ValidationError, match="WeaveApp"):
        validate_manifest(m)
    assert [f.rel_path for f in validate_manifest(manifest())] == ["WeaveApp.kt"]


def test_duplicate_files_rejected():
    m = manifest(files=[{"path": "WeaveApp.kt", "content": ENTRY}, {"path": "weaveapp.kt", "content": ENTRY}])
    with pytest.raises(ValidationError):
        validate_manifest(m)


# ---------- schema ----------
@pytest.mark.parametrize("field,value", [
    ("package_id", "Com.Bad"), ("package_id", "com"), ("package_id", "com.weave.class"),
    ("package_id", "com..x"), ("primary_color", "red"), ("primary_color", "#12345"),
    ("dependencies", ["com.squareup.retrofit2:retrofit:2.9.0"]), ("category", "crypto_wallet"),
    ("app_name", "<script>"),
])
def test_manifest_schema_rejects(field, value):
    with pytest.raises(PydanticValidationError):
        manifest(**{field: value})


def test_manifest_extra_fields_forbidden():
    with pytest.raises(PydanticValidationError):
        manifest(gradle_script="rm -rf /")


def test_build_request_limits():
    with pytest.raises(PydanticValidationError):
        BuildRequest(prompt="short")
    with pytest.raises(PydanticValidationError):
        BuildRequest(prompt="x" * 5000)
    with pytest.raises(PydanticValidationError):
        BuildRequest(prompt="a valid description here", app_name="bad/name")
    assert BuildRequest(prompt="  a valid description here ", app_name=" ").app_name is None


# ---------- repair patches ----------
def test_patch_cannot_touch_protected_or_escape():
    current = {"WeaveApp.kt": ENTRY}
    for path in ("MainActivity.kt", "../build.gradle.kts", "ui/theme/Theme.kt"):
        with pytest.raises(ValidationError):
            validate_patch(RepairPatch(explanation="x", files=[GeneratedFile(path=path, content=ENTRY)]), current)


def test_patch_limits_new_files():
    current = {"WeaveApp.kt": ENTRY}
    files = [GeneratedFile(path=f"N{i}.kt", content="package com.weave.app\n") for i in range(4)]
    with pytest.raises(ValidationError, match="too many new files"):
        validate_patch(RepairPatch(explanation="x", files=files), current)
    ok = validate_patch(RepairPatch(explanation="x", files=[GeneratedFile(path="WeaveApp.kt", content=ENTRY)]), current)
    assert ok[0].rel_path == "WeaveApp.kt"


def test_manifest_requires_design_kit():
    plain = ENTRY.replace("import com.weave.app.ui.kit.Spacing\n", "")
    with pytest.raises(ValidationError, match="design kit"):
        validate_manifest(manifest(files=[{"path": "WeaveApp.kt", "content": plain}]))
