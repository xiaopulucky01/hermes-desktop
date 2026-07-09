"""Desktop bundle: default CREATE_NO_WINDOW on Windows subprocess spawns."""

from __future__ import annotations

import sys

if sys.platform == "win32":
    import subprocess

    _ORIG_POPEN_INIT = subprocess.Popen.__init__

    def _popen_hide_console(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        creationflags = kwargs.get("creationflags")
        if creationflags is None:
            creationflags = 0
        create_no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        create_new_console = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
        detached_process = getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
        if not (creationflags & (create_new_console | detached_process)):
            creationflags |= create_no_window
        kwargs["creationflags"] = creationflags
        return _ORIG_POPEN_INIT(self, *args, **kwargs)

    subprocess.Popen.__init__ = _popen_hide_console  # type: ignore[method-assign]
