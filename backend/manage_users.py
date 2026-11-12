#!/usr/bin/env python3
"""Manage AVL GUI accounts (there is no self sign-up).

  python manage_users.py add <username>       # asks for the password twice
  python manage_users.py passwd <username>    # change password, logs the user out everywhere
  python manage_users.py remove <username>    # delete account, logs the user out
  python manage_users.py list

Add --password-stdin to `add` / `passwd` to read the password from stdin instead.
On the server use the wrapper:  avl-users add <username>
"""
import getpass
import re
import sys
import time

import auth

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{2,32}$")
MIN_PASSWORD = 8


def read_password(from_stdin: bool) -> str:
    if from_stdin:
        pw = sys.stdin.readline().rstrip("\n")
    else:
        pw = getpass.getpass("Password: ")
        if pw != getpass.getpass("Repeat password: "):
            sys.exit("Passwords do not match.")
    if len(pw) < MIN_PASSWORD:
        sys.exit(f"Password must be at least {MIN_PASSWORD} characters.")
    if len(pw) > 256:
        sys.exit("Password is too long (max 256 characters).")
    return pw


def main(argv) -> None:
    from_stdin = "--password-stdin" in argv
    args = [a for a in argv if a != "--password-stdin"]
    if not args or args[0] not in ("add", "passwd", "remove", "list"):
        sys.exit(__doc__)
    cmd = args[0]
    users = auth.load_users()

    if cmd == "list":
        if not users:
            print("No users yet. Add one with: add <username>")
        for name, info in sorted(users.items()):
            print(f"{name}\t(created {info.get('created', '?')})")
        return

    if len(args) != 2:
        sys.exit(__doc__)
    name = args[1]

    if cmd == "add":
        if not USERNAME_RE.match(name):
            sys.exit("Username: 2-32 characters, letters, digits, . _ - only.")
        if name in users:
            sys.exit(f"User '{name}' already exists. Use: passwd {name}")
        users[name] = {"password": auth.hash_password(read_password(from_stdin)),
                       "created": time.strftime("%Y-%m-%d")}
        auth.save_users(users)
        print(f"Added user '{name}'.")
    elif cmd == "passwd":
        if name not in users:
            sys.exit(f"No user '{name}'.")
        users[name]["password"] = auth.hash_password(read_password(from_stdin))
        auth.save_users(users)
        print(f"Password changed for '{name}'.")
    elif cmd == "remove":
        if name not in users:
            sys.exit(f"No user '{name}'.")
        del users[name]
        auth.save_users(users)
        print(f"Removed user '{name}'.")


if __name__ == "__main__":
    main(sys.argv[1:])
