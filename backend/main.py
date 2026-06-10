import os
import re
import subprocess
import shutil
import uuid
import time
from typing import Dict, Any, List, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Configuration ─────────────────────────────────────────
AVL_BIN = "/opt/homebrew/bin/avl"
AVL_EXAMPLES_DIR = os.path.expanduser("~/Desktop/AVL_Examples")

app = FastAPI(title="AVL GUI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from typing import List, Dict, Any, Optional

# ── Models ────────────────────────────────────────────────

class RunRequest(BaseModel):
    avl_content: str
    alpha: float = 0.0
    beta: float = 0.0
    xref_override: Optional[float] = None
    controls: Dict[str, float] = {}
    trim_mode: str = "none" # "none" or "alpha"

class PolarRequest(BaseModel):
    avl_content: str
    alpha_start: float = -5.0
    alpha_end: float = 15.0
    alpha_step: float = 1.0
    xref_override: Optional[float] = None
    controls: Dict[str, float] = {}


# ── AVL File Parser ──────────────────────────────────────

def parse_avl_file(text: str) -> Dict[str, Any]:
    """Parse a .avl file into a structured dictionary."""
    lines = text.splitlines()
    result = {
        "name": "",
        "mach": 0.0,
        "iYsym": 0, "iZsym": 0, "Zsym": 0.0,
        "Sref": 0.0, "Cref": 0.0, "Bref": 0.0,
        "Xref": 0.0, "Yref": 0.0, "Zref": 0.0,
        "CDp": None,
        "surfaces": [],
    }

    # Strip comments and blank lines for header parsing
    clean = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('#') or stripped.startswith('!') or stripped == '':
            continue
        clean.append(stripped)

    if len(clean) < 5:
        return result

    idx = 0
    # Line 0: name
    result["name"] = clean[idx]; idx += 1
    # Line 1: Mach
    try:
        result["mach"] = float(clean[idx]); idx += 1
    except ValueError:
        idx += 1
    # Line 2: iYsym iZsym Zsym
    try:
        parts = clean[idx].split()
        result["iYsym"] = int(parts[0])
        result["iZsym"] = int(parts[1])
        result["Zsym"] = float(parts[2])
        idx += 1
    except (ValueError, IndexError):
        idx += 1
    # Line 3: Sref Cref Bref
    try:
        parts = clean[idx].split()
        result["Sref"] = float(parts[0])
        result["Cref"] = float(parts[1])
        result["Bref"] = float(parts[2])
        idx += 1
    except (ValueError, IndexError):
        idx += 1
    # Line 4: Xref Yref Zref
    try:
        parts = clean[idx].split()
        result["Xref"] = float(parts[0])
        result["Yref"] = float(parts[1])
        result["Zref"] = float(parts[2])
        idx += 1
    except (ValueError, IndexError):
        idx += 1

    # Now parse full lines for SURFACE/SECTION keywords
    i = 0
    current_surface = None
    current_section = None

    while i < len(lines):
        line = lines[i].strip()
        upper = line.upper()

        if upper == 'SURFACE':
            # Save previous
            if current_section and current_surface:
                current_surface["sections"].append(current_section)
            if current_surface:
                result["surfaces"].append(current_surface)
            current_section = None

            i += 1
            surf_name = lines[i].strip() if i < len(lines) else "Unknown"
            i += 1
            # skip comment lines
            while i < len(lines) and (lines[i].strip().startswith('#') or lines[i].strip().startswith('!')):
                i += 1
            # Nchord Cspace [Nspan Sspace]
            nchord, cspace, nspan, sspace = 12, 1.0, 20, 1.0
            if i < len(lines):
                parts = lines[i].strip().split()
                try:
                    nchord = int(parts[0])
                    cspace = float(parts[1])
                    if len(parts) >= 4:
                        nspan = int(parts[2])
                        sspace = float(parts[3])
                except (ValueError, IndexError):
                    pass
                i += 1

            current_surface = {
                "name": surf_name,
                "nchord": nchord,
                "cspace": cspace,
                "nspan": nspan,
                "sspace": sspace,
                "yduplicate": None,
                "angle": None,
                "translate": None,
                "sections": [],
            }
            continue

        elif upper == 'YDUPLICATE' and current_surface:
            i += 1
            if i < len(lines):
                try:
                    current_surface["yduplicate"] = float(lines[i].strip())
                except ValueError:
                    pass
                i += 1
            continue

        elif upper == 'ANGLE' and current_surface:
            i += 1
            if i < len(lines):
                try:
                    current_surface["angle"] = float(lines[i].strip())
                except ValueError:
                    pass
                i += 1
            continue

        elif upper == 'TRANSLATE' and current_surface:
            i += 1
            if i < len(lines):
                parts = lines[i].strip().split()
                try:
                    current_surface["translate"] = [float(x) for x in parts[:3]]
                except (ValueError, IndexError):
                    pass
                i += 1
            continue

        elif upper == 'SECTION' and current_surface:
            if current_section:
                current_surface["sections"].append(current_section)
            i += 1
            # skip comment lines
            while i < len(lines) and (lines[i].strip().startswith('#') or lines[i].strip().startswith('!')):
                i += 1
            # Xle Yle Zle Chord Ainc [Nspan Sspace]
            sec = {"Xle": 0, "Yle": 0, "Zle": 0, "Chord": 0, "Ainc": 0,
                   "Nspan": 0, "Sspace": 0, "afile": None, "controls": [], "claf": None}
            if i < len(lines):
                parts = lines[i].strip().split()
                try:
                    sec["Xle"] = float(parts[0])
                    sec["Yle"] = float(parts[1])
                    sec["Zle"] = float(parts[2])
                    sec["Chord"] = float(parts[3])
                    sec["Ainc"] = float(parts[4])
                    if len(parts) >= 6:
                        sec["Nspan"] = int(parts[5])
                    if len(parts) >= 7:
                        sec["Sspace"] = float(parts[6])
                except (ValueError, IndexError):
                    pass
                i += 1
            current_section = sec
            continue

        elif upper == 'AFILE' and current_section:
            i += 1
            if i < len(lines):
                current_section["afile"] = lines[i].strip()
                i += 1
            continue

        elif upper == 'CONTROL' and current_section:
            i += 1
            if i < len(lines):
                parts = lines[i].strip().split()
                ctrl = {"name": parts[0] if parts else "ctrl", "raw": lines[i].strip()}
                current_section["controls"].append(ctrl)
                i += 1
            continue

        elif upper == 'CLAF' and current_section:
            i += 1
            if i < len(lines):
                try:
                    current_section["claf"] = float(lines[i].strip())
                except ValueError:
                    pass
                i += 1
            continue

        elif upper.startswith('CDP') or upper.startswith('CDO'):
            i += 1
            if i < len(lines):
                try:
                    result["CDp"] = float(lines[i].strip())
                except ValueError:
                    pass
                i += 1
            continue

        i += 1

    # Save last section/surface
    if current_section and current_surface:
        current_surface["sections"].append(current_section)
    if current_surface:
        result["surfaces"].append(current_surface)

    # Extract unique controls in order of appearance
    all_controls = []
    seen = set()
    for surf in result["surfaces"]:
        for sec in surf["sections"]:
            for ctrl in sec.get("controls", []):
                name = ctrl["name"]
                if name not in seen:
                    seen.add(name)
                    all_controls.append(name)
    result["controls"] = all_controls

    return result


def override_xref(content: str, new_xref: float) -> str:
    lines = content.splitlines()
    clean_lines = []
    for i, line in enumerate(lines):
        if line.strip() and not line.strip().startswith('#') and not line.strip().startswith('!'):
            clean_lines.append(i)
    
    if len(clean_lines) >= 5:
        idx = clean_lines[4]
        parts = lines[idx].split()
        if len(parts) >= 3:
            lines[idx] = f"{new_xref:.4f} {parts[1]} {parts[2]}"
    return "\n".join(lines)


# ── AVL Runner ───────────────────────────────────────────

def _run_avl(req: RunRequest) -> str:
    work_dir = AVL_EXAMPLES_DIR
    req_id = str(uuid.uuid4())[:8]
    model_filename = f"_gui_model_{req_id}.avl"
    st_filename = f"_gui_st_{req_id}.txt"
    model_path = os.path.join(work_dir, model_filename)
    st_path = os.path.join(work_dir, st_filename)
    
    content = req.avl_content
    if req.xref_override is not None:
        content = override_xref(content, req.xref_override)

    try:
        with open(model_path, "w") as f:
            f.write(content)

        parsed = parse_avl_file(content)
        controls_list = parsed.get("controls", [])

        cmds = [f"load {model_filename}", "oper"]
        
        # Apply trim mode or alpha
        if req.trim_mode == "alpha":
            cmds.extend(["a", "pm", "0"])
        else:
            cmds.append(f"a a {req.alpha}")

        # Set Beta
        cmds.append(f"b b {req.beta}")

        # Apply control deflections
        for ctrl_name, val in req.controls.items():
            if ctrl_name in controls_list:
                idx = controls_list.index(ctrl_name) + 1
                cmds.extend([f"d{idx}", f"d{idx}", str(val)])

        cmds.extend([
            "x",
            "st",
            st_filename,
            "",
            "",
            "quit",
        ])
        cmd = "\n".join(cmds) + "\n"
        
        max_attempts = 10
        proc = None
        for attempt in range(1, max_attempts + 1):
            proc = subprocess.run(
                [AVL_BIN],
                input=cmd,
                text=True,
                cwd=work_dir,
                capture_output=True,
                timeout=30,
            )
            if proc.returncode == 0:
                break
            elif proc.returncode in (-6, 134) or "syscall to map cache" in proc.stderr:
                time.sleep(0.05)
            else:
                break
                
        if os.path.exists(st_path):
            with open(st_path) as f:
                return f.read()
        return proc.stdout if proc else ""
    finally:
        if os.path.exists(model_path):
            os.remove(model_path)
        if os.path.exists(st_path):
            os.remove(st_path)


def _parse_output(output: str) -> Dict[str, Any]:
    results: Dict[str, Any] = {"raw": output}

    # All the keys we want to extract via regex
    # Format: "label in file" -> "key in results"
    # AVL st output has lines like:  CLtot =   0.12345   CDtot =   0.00123
    # Some lines have two values on one line, some have one.

    # ── Total force/moment coefficients ──
    scalar_keys = {
        "CLtot": "CLtot",
        "CDtot": "CDtot",
        "CDvis": "CDvis",
        "CDind": "CDind",
        "CYtot": "CYtot",
        "Cltot": "Cltot",
        "Cmtot": "Cmtot",
        "Cntot": "Cntot",
        "CLff":  "CLff",
        "CDff":  "CDff",
        "CYff":  "CYff",
        "e":     "e_oswald",
    }

    # ── Stability derivatives ──
    deriv_keys = {
        # Alpha derivatives
        "CLa":  "CLa",
        "CYa":  "CYa",
        "Cla":  "Cla",
        "Cma":  "Cma",
        "Cna":  "Cna",
        # Beta derivatives
        "CLb":  "CLb",
        "CYb":  "CYb",
        "Clb":  "Clb",
        "Cmb":  "Cmb",
        "Cnb":  "Cnb",
        # Roll rate (p) derivatives
        "CLp":  "CLp",
        "CYp":  "CYp",
        "Clp":  "Clp",
        "Cnp":  "Cnp",
        # Pitch rate (q) derivatives
        "CLq":  "CLq",
        "Cmq":  "Cmq",
        # Yaw rate (r) derivatives
        "CYr":  "CYr",
        "Clr":  "Clr",
        "Cnr":  "Cnr",
        # Alpha-dot derivatives
        "CLad": "CLad",
        "Cmad": "Cmad",
    }

    all_keys = {}
    all_keys.update(scalar_keys)
    all_keys.update(deriv_keys)

    for key in all_keys.values():
        results[key] = None

    # Also extract Xnp, alpha, static margin
    results["Xnp"] = None
    results["alpha"] = None
    results["static_margin"] = None

    for line in output.splitlines():
        # Extract all "Key = Value" pairs on the line
        for file_label, res_key in all_keys.items():
            # Use word boundary to avoid partial matches (e.g. CLad vs CLa)
            pattern = r'\b' + re.escape(file_label) + r'\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)'
            m = re.search(pattern, line)
            if m and results[res_key] is None:
                try:
                    results[res_key] = float(m.group(1))
                except ValueError:
                    pass

        # Neutral point
        if "Neutral point  Xnp" in line:
            m = re.search(r'Xnp\s*=\s*([-+]?\d*\.?\d+)', line)
            if m:
                results["Xnp"] = float(m.group(1))

        # Alpha
        if "Alpha =" in line and results["alpha"] is None:
            m = re.search(r'Alpha\s*=\s*([-+]?\d*\.?\d+)', line)
            if m:
                results["alpha"] = float(m.group(1))

    # Compute static margin if we have Xnp
    # (Xnp - Xref) / Cref  ... but we don't have Xref here, just provide Xnp
    # The frontend can compute static margin from parsed model data

    # Convenience aliases for frontend
    results["CL"] = results["CLtot"]
    results["CD"] = results["CDtot"]
    results["Cm"] = results["Cmtot"]
    results["Cma"] = results.get("Cma")

    return results


# ── Endpoints ─────────────────────────────────────────────

@app.get("/api/ping")
def ping():
    return {"status": "ok"}


@app.get("/api/models")
def list_models():
    """List all .avl files in the examples directory."""
    if not os.path.isdir(AVL_EXAMPLES_DIR):
        raise HTTPException(status_code=404, detail="AVL examples directory not found")
    files = []
    for f in sorted(os.listdir(AVL_EXAMPLES_DIR)):
        if f.lower().endswith('.avl') and not f.startswith('_'):
            files.append(f)
    return {"models": files}


@app.get("/api/load")
def load_default():
    """Load and parse the default vanilla.avl file."""
    default_file = os.path.join(AVL_EXAMPLES_DIR, "vanilla.avl")
    if not os.path.isfile(default_file):
        raise HTTPException(status_code=404, detail="Default AVL file not found")
    with open(default_file) as f:
        content = f.read()
    return {"content": content, "parsed": parse_avl_file(content)}


@app.get("/api/load/{filename}")
def load_model(filename: str):
    """Load and parse any .avl file from the examples directory."""
    filepath = os.path.join(AVL_EXAMPLES_DIR, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail=f"File {filename} not found")
    with open(filepath) as f:
        content = f.read()
    return {"content": content, "parsed": parse_avl_file(content)}


@app.post("/api/upload")
async def upload_model(file: UploadFile = File(...)):
    """Upload a custom .avl file."""
    if not file.filename.lower().endswith('.avl'):
        raise HTTPException(status_code=400, detail="Only .avl files are accepted")
    content = (await file.read()).decode('utf-8', errors='replace')
    # Save to examples dir
    dest = os.path.join(AVL_EXAMPLES_DIR, file.filename)
    with open(dest, 'w') as f:
        f.write(content)
    return {"filename": file.filename, "content": content, "parsed": parse_avl_file(content)}


@app.post("/api/run")
def run_avl(req: RunRequest):
    if not os.path.isdir(AVL_EXAMPLES_DIR):
        raise HTTPException(status_code=400, detail="AVL examples directory missing")
    try:
        raw = _run_avl(req)
        return _parse_output(raw)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="AVL timed out")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="AVL binary not found")
    except Exception as e:
        import traceback
        with open("/Users/ibrokhim/.gemini/antigravity-ide/scratch/backend_errors.log", "a") as logf:
            traceback.print_exc(file=logf)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/run-polar")
def run_polar(req: PolarRequest):
    if not os.path.isdir(AVL_EXAMPLES_DIR):
        raise HTTPException(status_code=400, detail="AVL examples directory missing")
        
    work_dir = AVL_EXAMPLES_DIR
    import uuid
    req_id = str(uuid.uuid4())[:8]
    model_filename = f"_gui_model_{req_id}.avl"
    model_path = os.path.join(work_dir, model_filename)
    
    st_files = []
    
    try:
        alpha_start = req.alpha_start
        alpha_end = req.alpha_end
        alpha_step = req.alpha_step
        
        if alpha_step <= 0:
            alpha_step = 1.0
        if alpha_start > alpha_end:
            alpha_start, alpha_end = alpha_end, alpha_start
            
        alphas = []
        curr = alpha_start
        while curr <= alpha_end + 1e-5:
            alphas.append(round(curr, 2))
            curr += alpha_step
            
        if len(alphas) > 50:
            alphas = alphas[:50]
            
        content = req.avl_content
        if req.xref_override is not None:
            content = override_xref(content, req.xref_override)
            
        with open(model_path, "w") as f:
            f.write(content)
            
        parsed = parse_avl_file(content)
        controls_list = parsed.get("controls", [])
        
        cmds = [f"load {model_filename}", "oper"]
        
        # Set Beta and control deflections once (constant in this oper session)
        cmds.append("b b 0.0")
        for ctrl_name, val in req.controls.items():
            if ctrl_name in controls_list:
                idx = controls_list.index(ctrl_name) + 1
                cmds.extend([f"d{idx}", f"d{idx}", str(val)])
                
        for i, a in enumerate(alphas):
            st_filename = f"_gui_st_{req_id}_{i}.txt"
            st_path = os.path.join(work_dir, st_filename)
            st_files.append((a, st_filename, st_path))
            
            cmds.extend([
                f"a a {a}",
                "x",
                "st",
                st_filename,
            ])
            
        cmds.extend(["", "quit"])
        cmd = "\n".join(cmds) + "\n"
        with open("/Users/ibrokhim/.gemini/antigravity-ide/scratch/backend_command.txt", "w") as cmdf:
            cmdf.write(cmd)
        
        # Run with retry logic
        max_attempts = 10
        proc = None
        for attempt in range(1, max_attempts + 1):
            proc = subprocess.run(
                [AVL_BIN],
                input=cmd,
                text=True,
                cwd=work_dir,
                capture_output=True,
                timeout=45,
            )
            if proc.returncode == 0:
                break
            elif proc.returncode in (-6, 134) or "syscall to map cache" in proc.stderr:
                time.sleep(0.05)
            else:
                break
                
        if proc and proc.returncode != 0:
            raise Exception(f"AVL process failed with exit code {proc.returncode}. Stderr: {proc.stderr}")
            
        data_points = []
        for a, st_filename, st_path in st_files:
            if os.path.exists(st_path):
                with open(st_path) as f:
                    st_data = f.read()
                parsed_st = _parse_output(st_data)
                if parsed_st.get("CLtot") is not None:
                    data_points.append({
                        "Alpha": a,
                        "CL": parsed_st.get("CLtot"),
                        "CD": parsed_st.get("CDtot"),
                        "Cm": parsed_st.get("Cmtot"),
                    })
                    
        return {"data": data_points, "raw": f"Polar sweep calculated successfully for {len(data_points)} points."}
        
    except Exception as e:
        import traceback
        with open("/Users/ibrokhim/.gemini/antigravity-ide/scratch/backend_errors.log", "a") as logf:
            traceback.print_exc(file=logf)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(model_path):
            try:
                os.remove(model_path)
            except OSError:
                pass
        for a, st_filename, st_path in st_files:
            if os.path.exists(st_path):
                try:
                    os.remove(st_path)
                except OSError:
                    pass
