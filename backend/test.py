import subprocess
import os

AVL_BIN = "/opt/homebrew/bin/avl"
if not os.path.exists(AVL_BIN):
    AVL_BIN = "./avl"

cmd = """load /Users/ibrokhim/Desktop/AVL_Examples/vanilla2.avl
oper
d1
d
5.0
x
st
test_st.txt


quit
"""
proc = subprocess.run([AVL_BIN], input=cmd, text=True, cwd="/Users/ibrokhim/.gemini/antigravity-ide/scratch/avl-gui/backend", capture_output=True)
print(proc.stdout)
