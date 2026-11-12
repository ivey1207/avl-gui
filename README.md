# AVL Aerodynamic Simulator & GUI

This repository contains the **Athena Vortex Lattice (AVL) Aerodynamic Simulator** and its modern interactive **Web GUI** dashboard.

- **Frontend**: React + Vite + Three.js / SVG (interactive 3D planform visualizer and real-time stability plots).
- **Backend**: FastAPI (Python wrapper that calls the native AVL binary, parses aerodynamic coefficients, and calculates longitudinal and lateral stability derivatives).
- **AVL Solver**: Native Fortran-77 solver source code is included under the `avl/` folder.
- **Model Examples**: Predefined and custom `.avl` files are included under the `examples/` folder.

---

## Проект: AVL Аэродинамический Симулятор и GUI

Этот репозиторий содержит **Athena Vortex Lattice (AVL)** аэродинамический решатель и современный интерактивный **Web GUI** интерфейс.

- **Фронтенд**: React + Vite + Three.js / SVG (3D-визуализация геометрии самолета, интерактивные графики поляр).
- **Бэкенд**: FastAPI (Python-обертка, запускающая нативный AVL, парсящая коэффициенты и рассчитывающая динамическую и статическую стабильность).
- **AVL Решатель**: Исходный код Фортрана находится в папке `avl/`.
- **Примеры моделей**: Готовые файлы `.avl` находятся в папке `examples/`.

---

## Project Structure / Структура проекта

```text
├── avl/             # AVL solver Fortran source code / Исходный код решателя AVL
├── backend/         # FastAPI Python backend server / Сервер бэкенда на FastAPI
├── frontend/        # React + Vite frontend client / Клиент фронтенда на React
├── examples/        # AVL model examples (.avl files) / Примерные файлы моделей
└── README.md        # This guide / Эта инструкция
```

---

## Setup & Running / Установка и Запуск

### 1. Build & Install AVL Solver / Сборка и установка AVL

You need `gfortran` (GNU Fortran compiler) installed on your system.
Для сборки вам понадобится компилятор `gfortran`.

#### macOS:
You can compile it using `gfortran` from Homebrew:
```bash
brew install gcc
```

Then, compile the libraries and AVL binary:
```bash
# 1. Build Xplot11
cd avl/plotlib
make gfortran

# 2. Build Eispack
cd ../eispack
make -f Makefile.gfortran

# 3. Build AVL
cd ../bin
make -f Makefile.gfortran avl
```
The executable `avl` will be created in `avl/bin/`. You can copy it to your path:
```bash
cp avl /usr/local/bin/avl  # or /opt/homebrew/bin/avl
```

---

### 2. Run Backend / Запуск бэкенда (FastAPI)

Prerequisites: Python 3.10+
Необходим Python версии 3.10 и выше.

1. Navigate to backend directory / Перейдите в папку бэкенда:
   ```bash
   cd backend
   ```
2. Create and activate virtual environment / Создайте и активируйте виртуальное окружение:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
3. Install dependencies / Установите зависимости:
   ```bash
   pip install -r requirements.txt
   ```
   *(Ensure `fastapi`, `uvicorn`, `pydantic` are installed).*
4. Run the backend / Запустите сервер:
   ```bash
   uvicorn main:app --host 127.0.0.1 --port 8000
   ```
   Backend will be running at / Бэкенд запустится на: [http://127.0.0.1:8000](http://127.0.0.1:8000)

> **Note**: The backend finds `avl` on your `PATH` and uses the repo's `examples/` folder. Override with the `AVL_BIN` / `AVL_EXAMPLES_DIR` environment variables if needed.
> **Примечание**: Бэкенд сам находит `avl` в `PATH` и использует папку `examples/` из репозитория. Другие пути можно задать переменными окружения `AVL_BIN` / `AVL_EXAMPLES_DIR`.

---

### 3. Run Frontend / Запуск фронтенда (React + Vite)

Prerequisites: Node.js (v18+)

1. Navigate to frontend directory / Перейдите в папку фронтенда:
   ```bash
   cd frontend
   ```
2. Install package dependencies / Установите зависимости npm:
   ```bash
   npm install
   ```
3. Start the dev server / Запустите сервер разработки:
   ```bash
   npm run dev
   ```
   Frontend will be running at / Фронтенд запустится на: [http://localhost:5173/](http://localhost:5173/)

   The dev server proxies `/api` to the backend on `127.0.0.1:8000`.
   Dev-сервер проксирует `/api` на бэкенд `127.0.0.1:8000`.

---

### 4. Deploy to a server / Деплой на сервер (Ubuntu)

One command from your Mac builds the frontend, uploads the project to `/opt/avl-gui`, compiles AVL on the server, and sets up the backend (systemd) and nginx on port 80.
Одна команда с Mac собирает фронтенд, загружает проект в `/opt/avl-gui`, компилирует AVL на сервере и настраивает бэкенд (systemd) и nginx на порту 80.

```bash
ssh-copy-id root@SERVER_IP        # once / один раз
./deploy/deploy.sh root@SERVER_IP # every deploy / при каждом деплое
```

Files / Файлы: `deploy/setup-server.sh` (runs on the server), `deploy/avl-gui.service`, `deploy/nginx-avl-gui.conf`.
Logs / Логи: `ssh root@SERVER_IP journalctl -u avl-gui -f`

### 5. Accounts / Учётные записи

The site requires a login; there is no self sign-up. Accounts are stored on the server in `/var/lib/avl-gui` (deploys never touch it).
Вход обязателен, самостоятельной регистрации нет. Учётки хранятся на сервере в `/var/lib/avl-gui` (деплой их не трогает).

```bash
ssh -t root@SERVER_IP avl-users add ivan      # create, asks for the password / создать, спросит пароль
ssh -t root@SERVER_IP avl-users passwd ivan   # change password (logs out everywhere) / сменить пароль
ssh -t root@SERVER_IP avl-users remove ivan   # delete account / удалить
ssh root@SERVER_IP avl-users list
```

Locally the same script works from `backend/`: `venv/bin/python manage_users.py add <name>` (stored in `backend/data/`, ignored by git).
Sessions last 7 days. Once the site has HTTPS, add `Environment=AVL_COOKIE_SECURE=1` to `deploy/avl-gui.service`.

---

## Features & Aerodynamic Analysis / Возможности и Аэродинамический Анализ

1. **Geometry Visualization**: Planform rendering (2D SVG) and interactive 3D model (Three.js) showing the wing planform, coordinates, control surfaces, and Center of Gravity (CG) position.
2. **Trim Calculation**: Find the Trim Angle of Attack ($\alpha$) where Pitching Moment $C_m = 0$.
3. **Aerodynamic Derivatives**: Real-time extraction of lift ($C_L$), drag ($C_D$), pitching moment ($C_m$) coefficients, and stability derivatives ($C_{m\alpha}$, $C_{l\beta}$, etc.).
4. **Dynamic Stability Estimation**: Automatically calculates Short Period and Phugoid oscillation frequency, period, and damping ratios.
5. **Polar Sweeps**: Generate drag polars ($C_L$ vs $C_D$) and pitching moment curves ($C_m$ vs $\alpha$) to evaluate overall static stability.
