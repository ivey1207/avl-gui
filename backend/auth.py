"""Accounts and login sessions for AVL GUI.

Users are stored in DATA_DIR/users.json and managed with manage_users.py
(there is no self sign-up). A session is an HMAC-signed cookie; the signing
key lives in DATA_DIR/secret.key. Changing a user's password or removing the
user invalidates their existing sessions.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Dict, Optional

DATA_DIR = os.environ.get("AVL_DATA_DIR") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "data")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
SECRET_FILE = os.path.join(DATA_DIR, "secret.key")

COOKIE_NAME = "avl_session"
SESSION_TTL = 7 * 24 * 3600  # one week
PBKDF2_ITERATIONS = 600_000


# ── Passwords ─────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(),
                                 bytes.fromhex(salt_hex), int(iterations))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


# Checked against when the username is unknown, so that case takes as long as a wrong password.
_DUMMY_HASH = hash_password(secrets.token_hex(16))


# ── User store ────────────────────────────────────────────

def load_users() -> Dict[str, dict]:
    try:
        with open(USERS_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_users(users: Dict[str, dict]) -> None:
    os.makedirs(DATA_DIR, mode=0o700, exist_ok=True)
    tmp = USERS_FILE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(users, f, indent=2)
    os.replace(tmp, USERS_FILE)


def authenticate(username: str, password: str) -> bool:
    user = load_users().get(username)
    ok = verify_password(password, user["password"] if user else _DUMMY_HASH)
    return ok and user is not None


# ── Sessions ──────────────────────────────────────────────

_secret_cache: Optional[bytes] = None


def _secret() -> bytes:
    global _secret_cache
    if _secret_cache:
        return _secret_cache
    os.makedirs(DATA_DIR, mode=0o700, exist_ok=True)
    try:
        fd = os.open(SECRET_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_hex(32))
    except FileExistsError:
        pass
    key = ""
    for _ in range(100):  # another worker may be writing it right now
        with open(SECRET_FILE) as f:
            key = f.read().strip()
        if key:
            break
        time.sleep(0.01)
    if not key:
        raise RuntimeError(f"Session key file {SECRET_FILE} is empty")
    _secret_cache = key.encode()
    return _secret_cache


def _password_tag(stored_hash: str) -> str:
    return hashlib.sha256(stored_hash.encode()).hexdigest()[:16]


def _sign(body: str) -> str:
    return hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()


def make_token(username: str) -> str:
    user = load_users()[username]
    payload = {"u": username, "exp": int(time.time()) + SESSION_TTL,
               "p": _password_tag(user["password"])}
    body = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{body}.{_sign(body)}"


def verify_token(token: Optional[str]) -> Optional[str]:
    """Return the username for a valid session token, else None."""
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sign(body)):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except ValueError:
        return None
    if not isinstance(data, dict) or data.get("exp", 0) < time.time():
        return None
    user = load_users().get(data.get("u"))
    if not user or data.get("p") != _password_tag(user["password"]):
        return None
    return data["u"]
