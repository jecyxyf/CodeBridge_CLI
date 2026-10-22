"""Optional OS folder chooser isolated from HTTP request threads."""
import json
import tkinter as tk
from tkinter import filedialog


def main():
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    try:
        selected = filedialog.askdirectory(title='选择要共享的本地文件夹', parent=root)
        print(json.dumps({'folder': selected}, ensure_ascii=True))
    finally:
        root.destroy()

if __name__ == '__main__':
    main()
