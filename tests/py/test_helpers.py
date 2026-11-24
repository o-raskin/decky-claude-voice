import json
import os

import main

_REAL_USER_ENV = main.user_env


def test_user_env_points_at_deck_user(env):
    e = main.user_env()
    assert e["USER"] == "deck" and e["LOGNAME"] == "deck"
    assert e["XDG_RUNTIME_DIR"] == "/run/user/1000"
    assert e["DBUS_SESSION_BUS_ADDRESS"] == "unix:path=/run/user/1000/bus"
    assert e["PIPEWIRE_RUNTIME_DIR"] == "/run/user/1000"


def test_real_user_env_uses_user_home(monkeypatch):
    monkeypatch.setattr(main, "USER_HOME", "/x")
    e = _REAL_USER_ENV()
    assert e["HOME"] == "/x"
    assert e["PATH"].startswith("/x/.local/bin:")


def test_read_json_missing_invalid_valid(tmp_path):
    assert main._read_json(str(tmp_path / "none"), {"d": 1}) == {"d": 1}
    bad = tmp_path / "bad.json"
    bad.write_text("{nope")
    assert main._read_json(str(bad), []) == []
    ok = tmp_path / "ok.json"
    ok.write_text('{"a": 1}')
    assert main._read_json(str(ok), None) == {"a": 1}


def test_write_json_atomic_and_unicode(tmp_path):
    p = str(tmp_path / "f.json")
    main._write_json(p, {"t": "Привет"})
    assert not os.path.exists(p + ".tmp")
    assert "Привет" in open(p, encoding="utf-8").read()
    assert json.load(open(p, encoding="utf-8")) == {"t": "Привет"}


def test_new_chat_obj_defaults_and_cfg_copy():
    c = main._new_chat_obj()
    assert c["cfg"] is None and c["events"] == [] and c["session_id"] is None and c["title"] == ""
    assert len(c["id"]) == 10 and c["created"] == c["updated"]
    cfg = {"model": "opus"}
    c2 = main._new_chat_obj(cfg)
    assert c2["cfg"] == cfg and c2["cfg"] is not cfg
    assert c2["id"] != c["id"]


def test_model_ready(env):
    assert main._model_ready() is False
    with open(main.MODEL, "wb") as f:
        f.truncate(1000)
    assert main._model_ready() is False
    env.make_model()
    assert main._model_ready() is True


def test_describe_each_tool():
    d = main._describe
    assert d("Bash", {"command": "ls"}) == "Command: ls"
    assert d("Bash", {}) == "Command: "
    assert d("Edit", {"file_path": "/a"}) == "Edit file: /a"
    assert d("MultiEdit", {"file_path": "/b"}) == "Edit file: /b"
    assert d("Write", {"file_path": "/c"}) == "Write file: /c"
    assert d("Read", {"file_path": "/d"}) == "Read: /d"
    assert d("Glob", {"pattern": "*.py"}) == "Search: *.py"
    assert d("Grep", {"pattern": "x"}) == "Search: x"
    assert d("WebSearch", {"query": "q"}) == "Web search: q"
    assert d("WebFetch", {"url": "http://u"}) == "Opens: http://u"


def test_describe_generic_truncates_and_handles_non_dict():
    assert main._describe("Foo", "not a dict") == "Foo"
    s = main._describe("Foo", {"k": "я" * 500})
    assert s.startswith("Foo: {") and len(s) <= len("Foo: ") + 300
    assert "я" in s  # not ascii-escaped


def test_preview_kinds_and_truncation():
    p = main._preview
    assert p("Bash", {"command": "x" * 2000}) == {"kind": "command", "text": "x" * 1200}
    d = p("Edit", {"file_path": "/f", "old_string": "o" * 900, "new_string": "n" * 900})
    assert d == {"kind": "diff", "path": "/f", "old": "o" * 500, "new": "n" * 500}
    assert p("MultiEdit", {"file_path": "/f"})["kind"] == "diff"
    w = p("Write", {"file_path": "/w", "content": "c" * 900})
    assert w == {"kind": "file", "path": "/w", "text": "c" * 600}
    o = p("Other", {"a": "я" * 900})
    assert o["kind"] == "other" and len(o["text"]) == 600
