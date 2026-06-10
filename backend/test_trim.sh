#!/bin/bash
cd /Users/ibrokhim/.gemini/antigravity-ide/scratch/avl-gui/backend
AVL_BIN=$(which avl)
if [ -z "$AVL_BIN" ]; then
    AVL_BIN="./avl"
fi
$AVL_BIN << AVL_CMD
load /Users/ibrokhim/Desktop/AVL_Examples/vanilla2.avl
oper
d
quit
AVL_CMD
