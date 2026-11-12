import os
import re
import subprocess
import shutil
import uuid
import time
from typing import Dict, Any, List, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import auth

# ── Configuration ─────────────────────────────────────────
# Override with env vars AVL_BIN / AVL_EXAMPLES_DIR if needed.
AVL_BIN = os.environ.get("AVL_BIN") or shutil.which("avl") or "/opt/homebrew/bin/avl"
AVL_EXAMPLES_DIR = os.environ.get("AVL_EXAMPLES_DIR") or os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "examples"))

# Set AVL_COOKIE_SECURE=1 once the site is served over HTTPS.
COOKIE_SECURE = os.environ.get("AVL_COOKIE_SECURE") == "1"

# The frontend is served from the same origin (nginx / Vite proxy), so no CORS is needed.
app = FastAPI(title="AVL GUI Backend")

# ── Login ─────────────────────────────────────────────────
# Everything except these paths requires a valid session cookie.
PUBLIC_PATHS = {"/api/ping", "/api/login", "/api/logout", "/api/me"}


@app.middleware("http")
async def require_login(request: Request, call_next):
    if request.url.path not in PUBLIC_PATHS:
        if not auth.verify_token(request.cookies.get(auth.COOKIE_NAME)):
            return JSONResponse({"detail": "Not logged in"}, status_code=401)
    return await call_next(request)


class LoginRequest(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


@app.post("/api/login")
def login(req: LoginRequest, response: Response):
    username = req.username.strip()
    if not auth.authenticate(username, req.password):
        raise HTTPException(status_code=401, detail="Wrong username or password")
    response.set_cookie(
        auth.COOKIE_NAME, auth.make_token(username),
        max_age=auth.SESSION_TTL, httponly=True, samesite="strict",
        secure=COOKIE_SECURE, path="/",
    )
    return {"username": username}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    username = auth.verify_token(request.cookies.get(auth.COOKIE_NAME))
    if not username:
        raise HTTPException(status_code=401, detail="Not logged in")
    return {"username": username}


# ── Models ────────────────────────────────────────────────

class RunRequest(BaseModel):
    avl_content: str
    alpha: float = 0.0
    beta: float = 0.0
    xref_override: Optional[float] = None
    controls: Dict[str, float] = {}
    trim_mode: str = "none"  # "none" or "alpha"

class PolarRequest(BaseModel):
    avl_content: str
    alpha_start: float = -5.0
    alpha_end: float = 15.0
    alpha_step: float = 1.0
    xref_override: Optional[float] = None
    controls: Dict[str, float] = {}

class RunCase(BaseModel):
    label: str
    alpha: float = 0.0
    beta: float = 0.0
    controls: Dict[str, float] = {}
    trim_mode: str = "none"

class MultiCaseRequest(BaseModel):
    avl_content: str
    cases: List[RunCase]
    xref_override: Optional[float] = None


# ── AVL File Parser ──────────────────────────────────────

def parse_avl_file(text: str) -> Dict[str, Any]:
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

    clean = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('#') or stripped.startswith('!') or stripped == '':
            continue
        clean.append(stripped)

    if len(clean) < 5:
        return result

    idx = 0
    result["name"] = clean[idx]; idx += 1
    try:
        result["mach"] = float(clean[idx]); idx += 1
    except ValueError:
        idx += 1
    try:
        parts = clean[idx].split()
        result["iYsym"] = int(parts[0])
        result["iZsym"] = int(parts[1])
        result["Zsym"] = float(parts[2])
        idx += 1
    except (ValueError, IndexError):
        idx += 1
    try:
        parts = clean[idx].split()
        result["Sref"] = float(parts[0])
        result["Cref"] = float(parts[1])
        result["Bref"] = float(parts[2])
        idx += 1
    except (ValueError, IndexError):
        idx += 1
    try:
        parts = clean[idx].split()
        result["Xref"] = float(parts[0])
        result["Yref"] = float(parts[1])
        result["Zref"] = float(parts[2])
        idx += 1
    except (ValueError, IndexError):
        idx += 1

    i = 0
    current_surface = None
    current_section = None

    while i < len(lines):
        line = lines[i].strip()
        upper = line.upper()

        if upper == 'SURFACE':
            if current_section and current_surface:
                current_surface["sections"].append(current_section)
            if current_surface:
                result["surfaces"].append(current_surface)
            current_section = None
            i += 1
            surf_name = lines[i].strip() if i < len(lines) else "Unknown"
            i += 1
            while i < len(lines) and (lines[i].strip().startswith('#') or lines[i].strip().startswith('!')):
                i += 1
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
                "name": surf_name, "nchord": nchord, "cspace": cspace,
                "nspan": nspan, "sspace": sspace, "yduplicate": None,
                "angle": None, "translate": None, "sections": [],
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
            while i < len(lines) and (lines[i].strip().startswith('#') or lines[i].strip().startswith('!')):
                i += 1
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

    if current_section and current_surface:
        current_surface["sections"].append(current_section)
    if current_surface:
        result["surfaces"].append(current_surface)

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


# ── Strip Forces Parser ───────────────────────────────────

def _parse_strip_forces(text: str) -> List[Dict]:
    """Parse AVL 'fs' strip forces output. Returns list of surfaces with strip data."""
    surfaces = []
    current_surface = None
    header_found = False

    for line in text.splitlines():
        # Detect surface header: "Surface #  1     Wing"
        m = re.match(r'\s*Surface\s+#\s*(\d+)\s+(.*)', line)
        if m:
            if current_surface:
                surfaces.append(current_surface)
            current_surface = {
                "surface_num": int(m.group(1)),
                "name": m.group(2).strip(),
                "strips": []
            }
            header_found = False
            continue

        if current_surface is None:
            continue

        # Detect the column header row
        if 'Yle' in line and ('Chord' in line or 'cl' in line):
            header_found = True
            continue

        if header_found and line.strip():
            parts = line.split()
            # Strip data lines start with an integer index
            if len(parts) >= 8:
                try:
                    j = int(parts[0])
                    strip = {
                        "j":      j,
                        "Yle":    float(parts[1]),
                        "Chord":  float(parts[2]),
                        "Area":   float(parts[3]),
                        "c_cl":   float(parts[4]),
                        "ai":     float(parts[5]),
                        "cl_norm": float(parts[6]),
                        "cl":     float(parts[7]),
                        "cd":     float(parts[8]) if len(parts) > 8 else 0.0,
                        "cdv":    float(parts[9]) if len(parts) > 9 else 0.0,
                        "cm_c4":  float(parts[10]) if len(parts) > 10 else 0.0,
                        "cm_LE":  float(parts[11]) if len(parts) > 11 else 0.0,
                        "CPxc":   float(parts[12]) if len(parts) > 12 else 0.25,
                    }
                    current_surface["strips"].append(strip)
                except (ValueError, IndexError):
                    pass

    if current_surface:
        surfaces.append(current_surface)

    return surfaces


# ── Hinge Moments Parser ──────────────────────────────────

def _parse_hinge_moments(text: str) -> List[Dict]:
    """Parse AVL 'hm' hinge moments output."""
    moments = []
    for line in text.splitlines():
        # Lines like: "  elevator        Hinge =  -0.00123"
        m = re.match(r'\s*(\S+)\s+Hinge\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)', line)
        if m:
            moments.append({
                "surface": m.group(1),
                "hinge_moment": float(m.group(2))
            })
    return moments


# ── AVL Output Parser ─────────────────────────────────────

def _parse_output(output: str) -> Dict[str, Any]:
    results: Dict[str, Any] = {"raw": output}

    scalar_keys = {
        "CLtot": "CLtot", "CDtot": "CDtot", "CDvis": "CDvis", "CDind": "CDind",
        "CYtot": "CYtot", "Cltot": "Cltot", "Cmtot": "Cmtot", "Cntot": "Cntot",
        "CLff":  "CLff",  "CDff":  "CDff",  "CYff":  "CYff",  "e":     "e_oswald",
    }

    deriv_keys = {
        # Alpha derivatives
        "CLa": "CLa", "CYa": "CYa", "Cla": "Cla", "Cma": "Cma", "Cna": "Cna",
        # Beta derivatives
        "CLb": "CLb", "CYb": "CYb", "Clb": "Clb", "Cmb": "Cmb", "Cnb": "Cnb",
        # Roll rate (p) derivatives
        "CLp": "CLp", "CYp": "CYp", "Clp": "Clp", "Cnp": "Cnp",
        # Pitch rate (q) derivatives
        "CLq": "CLq", "Cmq": "Cmq",
        # Yaw rate (r) derivatives
        "CYr": "CYr", "Clr": "Clr", "Cnr": "Cnr",
        # Alpha-dot derivatives
        "CLad": "CLad", "Cmad": "Cmad",
    }

    # Control derivatives: will be populated dynamically
    ctrl_derivs = {}

    all_keys = {}
    all_keys.update(scalar_keys)
    all_keys.update(deriv_keys)

    for key in all_keys.values():
        results[key] = None

    results["Xnp"] = None
    results["alpha"] = None
    results["static_margin"] = None
    results["spiral_stability"] = None
    results["control_derivs"] = {}

    for line in output.splitlines():
        for file_label, res_key in all_keys.items():
            pattern = r'\b' + re.escape(file_label) + r'\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)'
            m = re.search(pattern, line)
            if m and results.get(res_key) is None:
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

        # Spiral stability: Clb*Cnr/Clr*Cnb
        if "spirally stable" in line.lower() or "Clb Cnr / Clr Cnb" in line:
            m = re.search(r'([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*\(', line)
            if m:
                results["spiral_stability"] = float(m.group(1))

        # Control derivatives (e.g. "CLd1 =  0.012345")
        m_ctrl = re.findall(r'([A-Za-z]{2,3}d\d)\s*=\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)', line)
        for label, val in m_ctrl:
            try:
                results["control_derivs"][label] = float(val)
            except ValueError:
                pass

    results["CL"] = results["CLtot"]
    results["CD"] = results["CDtot"]
    results["Cm"] = results["Cmtot"]
    results["Cma"] = results.get("Cma")

    return results


# ── AVL Runner ───────────────────────────────────────────

def _build_run_commands(model_filename: str, req_alpha: float, req_beta: float,
                         trim_mode: str, controls: Dict, controls_list: List,
                         st_filename: str, fs_filename: str, hm_filename: str) -> str:
    cmds = [f"load {model_filename}", "oper"]

    if trim_mode == "alpha":
        cmds.extend(["a", "pm", "0"])
    else:
        cmds.append(f"a a {req_alpha}")

    cmds.append(f"b b {req_beta}")

    for ctrl_name, val in controls.items():
        if ctrl_name in controls_list:
            idx = controls_list.index(ctrl_name) + 1
            cmds.extend([f"d{idx}", f"d{idx}", str(val)])

    cmds.extend([
        "x",           # execute
        "st",          # stability derivatives
        st_filename,
        "fs",          # strip forces
        fs_filename,
        "hm",          # hinge moments
        hm_filename,
        "",
        "",
        "quit",
    ])
    return "\n".join(cmds) + "\n"


def _run_avl_full(content: str, alpha: float, beta: float, trim_mode: str,
                  controls: Dict, xref_override: Optional[float] = None) -> Dict:
    """Run AVL and return full results including strip forces and hinge moments."""
    work_dir = AVL_EXAMPLES_DIR
    req_id = str(uuid.uuid4())[:8]
    model_filename = f"_gui_model_{req_id}.avl"
    st_filename    = f"_gui_st_{req_id}.txt"
    fs_filename    = f"_gui_fs_{req_id}.txt"
    hm_filename    = f"_gui_hm_{req_id}.txt"
    model_path = os.path.join(work_dir, model_filename)
    st_path    = os.path.join(work_dir, st_filename)
    fs_path    = os.path.join(work_dir, fs_filename)
    hm_path    = os.path.join(work_dir, hm_filename)

    if xref_override is not None:
        content = override_xref(content, xref_override)

    try:
        with open(model_path, "w") as f:
            f.write(content)

        parsed = parse_avl_file(content)
        controls_list = parsed.get("controls", [])

        cmd = _build_run_commands(
            model_filename, alpha, beta, trim_mode, controls, controls_list,
            st_filename, fs_filename, hm_filename
        )

        max_attempts = 10
        proc = None
        for attempt in range(1, max_attempts + 1):
            proc = subprocess.run(
                [AVL_BIN], input=cmd, text=True,
                cwd=work_dir, capture_output=True, timeout=30,
            )
            if proc.returncode == 0:
                break
            elif proc.returncode in (-6, 134) or "syscall to map cache" in proc.stderr:
                time.sleep(0.05)
            else:
                break

        # Parse all outputs
        result = {}
        if os.path.exists(st_path):
            with open(st_path) as f:
                result = _parse_output(f.read())
        elif proc:
            result = _parse_output(proc.stdout)

        result["strips"] = []
        if os.path.exists(fs_path):
            with open(fs_path) as f:
                result["strips"] = _parse_strip_forces(f.read())

        result["hinge_moments"] = []
        if os.path.exists(hm_path):
            with open(hm_path) as f:
                result["hinge_moments"] = _parse_hinge_moments(f.read())

        return result

    finally:
        for p in [model_path, st_path, fs_path, hm_path]:
            if os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


# ── Endpoints ─────────────────────────────────────────────

@app.get("/api/ping")
def ping():
    return {"status": "ok"}


@app.get("/api/models")
def list_models():
    if not os.path.isdir(AVL_EXAMPLES_DIR):
        raise HTTPException(status_code=404, detail="AVL examples directory not found")
    files = []
    for f in sorted(os.listdir(AVL_EXAMPLES_DIR)):
        if f.lower().endswith('.avl') and not f.startswith('_'):
            files.append(f)
    return {"models": files}


@app.get("/api/load")
def load_default():
    default_file = os.path.join(AVL_EXAMPLES_DIR, "vanilla.avl")
    if not os.path.isfile(default_file):
        raise HTTPException(status_code=404, detail="Default AVL file not found")
    with open(default_file) as f:
        content = f.read()
    return {"content": content, "parsed": parse_avl_file(content)}


@app.get("/api/load/{filename}")
def load_model(filename: str):
    # Only plain .avl file names from the examples folder (no paths).
    if filename != os.path.basename(filename) or not filename.lower().endswith('.avl'):
        raise HTTPException(status_code=400, detail="Invalid file name")
    filepath = os.path.join(AVL_EXAMPLES_DIR, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail=f"File {filename} not found")
    with open(filepath) as f:
        content = f.read()
    return {"content": content, "parsed": parse_avl_file(content)}


@app.post("/api/upload")
async def upload_model(file: UploadFile = File(...)):
    if not file.filename.lower().endswith('.avl'):
        raise HTTPException(status_code=400, detail="Only .avl files are accepted")
    content = (await file.read()).decode('utf-8', errors='replace')
    # Not saved to disk: on a shared server one user's upload must not
    # overwrite the examples or show up in everyone's model list.
    return {"filename": os.path.basename(file.filename), "content": content, "parsed": parse_avl_file(content)}


@app.post("/api/run")
def run_avl(req: RunRequest):
    if not os.path.isdir(AVL_EXAMPLES_DIR):
        raise HTTPException(status_code=400, detail="AVL examples directory missing")
    try:
        return _run_avl_full(
            req.avl_content, req.alpha, req.beta,
            req.trim_mode, req.controls, req.xref_override
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="AVL timed out")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="AVL binary not found")
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/run-cases")
def run_multi_cases(req: MultiCaseRequest):
    """Run multiple flight cases and return comparison results."""
    if not os.path.isdir(AVL_EXAMPLES_DIR):
        raise HTTPException(status_code=400, detail="AVL examples directory missing")
    if len(req.cases) > 10:
        raise HTTPException(status_code=400, detail="Max 10 cases at once")
    try:
        results = []
        for case in req.cases:
            r = _run_avl_full(
                req.avl_content, case.alpha, case.beta,
                case.trim_mode, case.controls, req.xref_override
            )
            r["label"] = case.label
            r["alpha_input"] = case.alpha
            results.append(r)
        return {"cases": results}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/run-polar")
def run_polar(req: PolarRequest):
    if not os.path.isdir(AVL_EXAMPLES_DIR):
        raise HTTPException(status_code=400, detail="AVL examples directory missing")

    work_dir = AVL_EXAMPLES_DIR
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
        cmds.append("b b 0.0")
        for ctrl_name, val in req.controls.items():
            if ctrl_name in controls_list:
                idx = controls_list.index(ctrl_name) + 1
                cmds.extend([f"d{idx}", f"d{idx}", str(val)])

        for i, a in enumerate(alphas):
            st_filename = f"_gui_st_{req_id}_{i}.txt"
            st_path = os.path.join(work_dir, st_filename)
            st_files.append((a, st_filename, st_path))
            cmds.extend([f"a a {a}", "x", "st", st_filename])

        cmds.extend(["", "quit"])
        cmd = "\n".join(cmds) + "\n"

        max_attempts = 10
        proc = None
        for attempt in range(1, max_attempts + 1):
            proc = subprocess.run(
                [AVL_BIN], input=cmd, text=True,
                cwd=work_dir, capture_output=True, timeout=60,
            )
            if proc.returncode == 0:
                break
            elif proc.returncode in (-6, 134) or "syscall to map cache" in proc.stderr:
                time.sleep(0.05)
            else:
                break

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
                        "Xnp": parsed_st.get("Xnp"),
                        "e": parsed_st.get("e_oswald"),
                    })

        return {"data": data_points, "raw": f"Polar sweep: {len(data_points)} points."}

    except Exception as e:
        import traceback; traceback.print_exc()
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
