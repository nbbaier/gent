#!/usr/bin/env python3
"""Read droid's TUI 'Skills (N)' header count via a pty. Usage: droid_header.py <cwd>"""
import pty, os, re, sys, time, signal, struct, fcntl, termios

cwd = sys.argv[1]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.environ["TERM"] = "xterm-256color"
    os.execvp("droid", ["droid"])

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 200, 0, 0))
ansi = re.compile(rb"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]|[\x00-\x08\x0b-\x1a\x1c-\x1f]")
buf = b""
deadline = time.time() + 60
result = None
while time.time() < deadline:
    try:
        data = os.read(fd, 65536)
    except OSError:
        break
    if not data:
        break
    buf += data
    clean = ansi.sub(b"", buf)
    m = re.search(rb"Skills \((\d+)\)", clean)
    if m:
        result = m.group(1).decode()
        break

try:
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
except OSError:
    pass
print(result if result else "NO-HEADER", flush=True)
sys.exit(0 if result else 1)
