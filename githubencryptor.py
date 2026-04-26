import os, hashlib
import tkinter as tk
from tkinter import filedialog, simpledialog, messagebox
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

DEFAULT_PASSPHRASE = "githubjarivizero"
OUT_FILE = "bob.bin"

def key_from_passphrase(pw):
    return hashlib.sha256(pw.encode("utf-8")).digest()

def encrypt_bytes(data, key, iv):
    cipher = AES.new(key, AES.MODE_CBC, iv=iv)
    return cipher.encrypt(pad(data, AES.block_size))

def main():
    root = tk.Tk()
    root.withdraw()

    files = filedialog.askopenfilenames(title="Select files to encrypt")
    if not files:
        return

    pw = simpledialog.askstring(
        "Passphrase",
        "Enter passphrase:",
        initialvalue=DEFAULT_PASSPHRASE,
        show="*",
    )
    if pw is None:
        return

    key = key_from_passphrase(pw)
    records = []
    payload = bytearray()

    for path in files:
        name = os.path.basename(path)
        with open(path, "rb") as f:
            data = f.read()

        iv = os.urandom(16)
        enc = encrypt_bytes(data, key, iv)

        start = len(payload)
        payload.extend(iv)
        payload.extend(enc)
        end = len(payload) - 1

        records.append((name, start, end))

    with open(OUT_FILE, "wb") as f:
        f.write(payload)

    lines = []
    for name, start, end in records:
        lines.append(f"#{OUT_FILE}:{start}-{end}:{pw}:{name}")

    out_text = "\n".join(lines)
    print(out_text)

    try:
        root.clipboard_clear()
        root.clipboard_append(out_text)
        root.update()
    except Exception:
        pass

    messagebox.showinfo("Done", f"Saved {OUT_FILE}\n\n{out_text}")

if __name__ == "__main__":
    main()