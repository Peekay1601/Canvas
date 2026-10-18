# Step-by-step guide

Follow these parts in order. Each one ends with a check, so you know it worked before moving on.
Parts A–E are one-time setup. Parts F–G are what you do for every project: a series, a film, a short or an ad.

Commands go in a **terminal**: Terminal on Mac, PowerShell on Windows.

---

## Easiest: install the connector (no terminal)

1. Download **[seedance-production.mcpb](https://github.com/Peekay1601/G2-website/raw/claude/focused-brown-qiqg0d/seedance-mcp/seedance-production.mcpb)**.
2. Open **Claude Desktop → Settings → Extensions**, and drag the file in (or double-click it).
3. It may warn that the extension isn't signed; that's expected for a personal build. Click **Install**.
4. Fill in the form:
   - **BytePlus API key:** saved in your system keychain
   - **Seedance model ID:** e.g. `dreamina-seedance-2-5-260628`
   - **Projects folder:** pick or create e.g. `Documents/Seedance Projects`
   - **API address:** leave empty
5. Make sure the extension is switched **on**. In a new chat, click **+ → Connectors** and you'll see **Seedance Production**.
6. Say **Check production status**. On first start it installs its own Python packages, so the first reply can take a minute.

Everything else needs no terminal. ffmpeg is built in, and the background worker starts when you say *Queue EP01*. Ask *How's the worker doing?* to see progress, or *Stop the worker* to stop it. Then carry on from **Part D**.

To change your key or folder later: **Settings → Extensions → Seedance Production → Configure**.
To update: download the new `.mcpb` and install it again.

If Claude Desktop refuses the file (older versions don't support this kind of extension), update Claude Desktop, or use the one-command installer below instead.

---

## Character faces: the BytePlus Access Key (one-time, about 5 minutes)

Seedance blocks reference images that look like real people, and photoreal AI characters trip that filter (`InputImageSensitiveContentDetected`). The supported route is ModelArk's **private virtual portrait library**. With an Access Key added, the connector does this for you:
1. **Whenever you add a character image,** it's uploaded to a private storage bucket in your BytePlus account, registered in that character's portrait group, and checked by BytePlus. That takes about a minute per image, in the background.
2. **Shots then send the face as `asset://…`.** Locations, props and garment-only costumes go as normal images.
3. **A shot waits** until its characters' portraits are accepted, so nothing is spent on a request that would be blocked.
4. **If BytePlus refuses a portrait,** you're told which image and why. Replace that image and it's registered again automatically.

You do this once:
1. **Activate the library.** In the ModelArk console, check **Subscription Plans** for **Dreamina Seedance Advanced Creation Rights** and pick the free **Entry** tier if asked. It includes 50 portrait images. If you never see this, skip it: the first upload will tell you if it's needed.
2. **Create the Access Key.** In the BytePlus console, open **IAM** (Identity and Access Management):
   - **Users → Create user** (e.g. `seedance-connector`), with programmatic (API) access.
   - **Attach policies:** `ArkFullAccess` and `TOSFullAccess`.
   - **Create an Access Key** for that user, and copy the **Access Key ID** and **Secret Access Key**. The secret is shown only once.
3. **Add it to the connector.** Go to **Claude Desktop → Settings → Extensions → Seedance Production → Configure**, paste both into **BytePlus Access Key ID** and **BytePlus Secret Access Key**, and save. (Terminal install: run the installer again; it asks for them.)
4. **Register the faces.** In a chat, say *"Register my character portraits"*, then *"How are the portraits doing?"* until they show **Active**.

Tips:
- **Costumes:** make garment-only images (flat lay, hanger, mannequin). They don't need registering and don't use the 50-image quota. Only costumes shown worn are registered.
- **Continuation shots:** on this route they don't attach the previous shot's last frame, because frames show faces. Claude describes the end of the previous shot instead.
- **Replaced images still count** against the quota until removed. *"Clean up unused portraits"* lists them, and deletes only after you confirm.

---

## Quick start: one command does Parts A–E

Before you start, have your **BytePlus API key** and **Seedance model ID** ready. Get them from the [ModelArk console](https://console.byteplus.com/ark) after activating Seedance 2.5.

**Mac**: open **Terminal** (press ⌘+Space, type *Terminal*, Enter) and paste:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Peekay1601/G2-website/claude/focused-brown-qiqg0d/seedance-mcp/setup/install_mac.sh)"
```

**Windows**: open **PowerShell** (Start menu, type *PowerShell*, Enter) and paste:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://raw.githubusercontent.com/Peekay1601/G2-website/claude/focused-brown-qiqg0d/seedance-mcp/setup/install_windows.ps1 | iex"
```

It will:
1. Install uv, ffmpeg and Claude Desktop if they're missing. On a Mac without Homebrew it asks for your Mac password once.
2. Download the code to `~/seedance-studio` and run the tests, so you see them pass.
3. Ask for your API key (hidden as you type) and model ID, and save them in a private `seedance.env` file. You never have to type `export` again.
4. Create `Documents/Seedance Projects` with your first project folder in it.
5. Connect Claude Desktop. It keeps any other servers you have and backs up your old config.
6. Do a dry run, then ask before sending **one** real 5-second test (a few cents).
7. Put a **Start worker** launcher in the projects folder: double-click it to generate queued shots.

Then quit and reopen Claude Desktop, say **Check production status**, put your script in the project folder, and say **Start a new project** (Part F, guided).

Running it again is safe: it updates the code and keeps your settings. If any step fails, copy the output to Claude Code.

The manual parts below are what the installer does, for reference or if you prefer doing it by hand.

---

## Part A: Install the tools (once, ~15 min)

**1. uv** (installs Python for you)

- Mac: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Windows: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`

Close and reopen the terminal, then run `uv --version`.
✅ It prints a version number.

**2. ffmpeg** (extracts last frames and builds the rough cut)

- Mac: install [Homebrew](https://brew.sh), then `brew install ffmpeg`
- Windows: `winget install ffmpeg`

Reopen the terminal, then run `ffmpeg -version`.
✅ It prints a version.

**3. Git**

- Mac: `xcode-select --install`
- Windows: `winget install Git.Git`

**4. Claude Desktop** from [claude.ai/download](https://claude.ai/download). Sign in.

---

## Part B: Get the code and check it works (no credits used)

```bash
git clone https://github.com/Peekay1601/G2-website.git
cd G2-website
git checkout claude/focused-brown-qiqg0d
cd seedance-mcp
uv sync
uv run pytest -q
```

✅ The last line says `25 passed`. If ffmpeg isn't installed you'll see `22 passed, 3 skipped`, which is fine until you install it. These tests run the whole pipeline against a fake BytePlus server, so nothing is spent.
❌ If anything fails, copy the output to Claude.

---

## Part C: Connect BytePlus (one real generation, a few cents)

**1. In the [BytePlus ModelArk console](https://console.byteplus.com/ark):**
- Activate the Seedance 2.5 model.
- Copy its exact **model ID**, e.g. `dreamina-seedance-2-5-260628`.
- Create or copy your **API key**.

**2. Set them in the terminal.** You need to redo this in every new terminal window.

| | Mac | Windows (PowerShell) |
|---|---|---|
| Key | `export ARK_API_KEY="your-key"` | `$env:ARK_API_KEY="your-key"` |
| Model | `export SEEDANCE_MODEL="dreamina-seedance-2-5-260628"` | `$env:SEEDANCE_MODEL="dreamina-seedance-2-5-260628"` |

**3. Check the request, then send one cheap test:**

```bash
uv run test_generate.py --dry-run    # prints the request, sends nothing
uv run test_generate.py              # one 5-second 480p video
```

✅ You see `Task ID: ...`, then statuses, then `Saved outputs/<id>.mp4`. Open that MP4.
❌ If you get an error like `HTTP 400 ... InvalidParameter`, paste the whole error to Claude Code. The field names in `seedance/api.py` were built from public examples and may need a tweak. This is the most likely place for a first-run problem.

---

## Part D: Your projects folder

```
Documents/Seedance Projects/
  Start worker.command  (Windows: Start worker.bat)
  MyProject/
    READ_ME_FIRST.txt
    my_script.pdf          ← you put the script here (PDF, Word .docx, .txt or .fountain)
    assets/_inbox/         ← drop images here if you can't rename them
```

That's all you create. Once Claude has read the script and you've agreed what kind of production it is, Claude makes the rest:

| If it's… | It's divided into… | Folders |
|---|---|---|
| a web series / TV series | **episodes** | `episodes/EP01/` and `assets/EP01/{characters,costumes,locations,props}/` |
| a feature film, short film or documentary | **scenes** | `scenes/SC001/` and `assets/SC001/…` |
| an ad, music video, promo or social video | **shots** | `shots/SH01/` and `assets/SH01/…` |

You can keep many projects side by side, for example a series and an ad. Say **"Open project Chai Shots Ad"** or **"Start a new project called …"**. Each one has its own folders, settings and database.

**One file for the whole script is fine.** Claude splits it:
- **series:** at `EPISODE 1` / `Episode One` / `EP 01` / `ఎపిసోడ్ 1`
- **films:** at `SCENE 12` or every `INT.` / `EXT.` heading
- **ads:** at `SHOT 3` / `FRAME 3`

If the headings are unusual, Claude proposes where each part starts and saves them after you confirm, copying the text exactly. If a PDF's Telugu comes out as boxes, export the script as `.docx` or `.txt` instead.

Rules that save you trouble later:
- **Image names:** use exactly the names on the prompt sheet (capitals and underscores).
- **Images:** under 10 MB each. JPG or PNG at about 2000 px is plenty.

---

## Part E: Connect it to Claude Desktop

**1. Find two paths:**
- **uv:** run `which uv` (Mac) or `where uv` (Windows).
- **The code folder:** run `pwd` inside `seedance-mcp`.

**2. Open the config.** In Claude Desktop: **Settings → Developer → Edit Config**. Paste this, using your own paths and key:

```json
{
  "mcpServers": {
    "seedance": {
      "command": "/Users/you/.local/bin/uv",
      "args": ["--directory", "/Users/you/G2-website/seedance-mcp", "run", "server.py"],
      "env": {
        "ARK_API_KEY": "your-key",
        "SEEDANCE_MODEL": "dreamina-seedance-2-5-260628",
        "PROJECTS_ROOT": "/Users/you/Documents/Seedance Projects"
      }
    }
  }
}
```

On Windows, write paths with double backslashes, e.g. `"C:\\Users\\you\\Documents\\Seedance Projects"`.

**3. Restart Claude Desktop completely** (Quit, then reopen).

**4. In a new chat, type:** `Check production status.`

✅ Claude shows `online: true`, your model ID and your `PROJECT_DIR`.
❌ If Claude doesn't see the tool, go to **Settings → Developer**, click the `seedance` server and read its log. The usual cause is a wrong path or a missing comma in the JSON.

---

## Part F: Start a project (once per project)

Put the script in the project folder, then in Claude Desktop say **Start a new project** (or choose the **start_project** prompt). Claude:

1. **Reads the whole script and tells you what it thinks it is** (series, film, short, ad…), why, and how it would divide it. It lists every episode, scene or shot with a title and a one-line summary. Confirm or correct.
2. **Gives you options to choose from:**
   - **Aspect ratio:** 16:9 (YouTube/OTT/TV), 21:9 (cinemascope), 9:16 (Reels/Shorts/vertical ads), 1:1, 4:3, 3:4
   - **Resolution:** 480p (cheap tests), 720p (review/web), 1080p (final delivery)
   - **Look and feel:** it suggests the 2–3 presets that fit your script and explains why:
     - Natural realism
     - Warm nostalgic film
     - Gritty handheld thriller
     - Noir / low-key
     - Bright comedy
     - Epic cinematic
     - Glossy commercial
     - Documentary vérité

     Or describe your own look in a few lines.
3. **Splits the script and creates the folders** (the table in Part D).
4. **Writes the rest of the bible** (camera, lighting, performance, dialogue) to match your look, and shows it to you before saving.

Every new shot uses the project's ratio and resolution unless you change that shot. Change your mind later with *"Set the project to 9:16"* or *"Switch the look to warm nostalgic film"*.

---

## Part G: Make each episode / scene / shot

Use the unit's code: `EP01` for a series, `SC003` for a film, `SH02` for an ad.

**1. Prepare its images.** Say **Prepare assets for EP01** (or choose **prepare_assets**). Claude:
- lists every character, costume, location and prop in that unit, and reuses anything already finalised in an earlier unit
- writes the image prompts with your Lira skill and the project's look
- saves them in **`assets/EP01/EP01_IMAGE_PROMPTS.txt`**: one block per image, with the prompt, the aspect ratio, and the exact file name and folder to save it as

```
1. CHARACTER  ANU  (Anu)
Save as:  assets/EP01/characters/ANU.png
Aspect:   3:4
Prompt:
Photoreal identity reference of a 23-year-old Telugu woman…
```

**2. Make the images** in your image generator, pick the ones you like, and add them. There are three ways:

| How | What to do |
|---|---|
| **By name** (easiest) | Save each image with the name and folder from the sheet, e.g. `assets/EP01/characters/ANU.png`. Extra angles: `ANU_2.png`, `ANU_SIDE.png`. Then say *"I've added the images."* |
| **From anywhere** | Tell Claude the path: *"Use ~/Downloads/anu_final_v7.png for ANU."* It copies the file into the right folder under the right name. To replace an image, do the same again; the old one is kept as `ANU_old1.png`. |
| **Inbox** | Drop images with any names into `assets/_inbox/`, then say *"I've put images in the inbox."* Claude lists them and asks which is which. |

Claude then checks what's linked and what's still missing. Images in the chat window don't count: they aren't saved on your computer, so use one of the three ways above.

**3. Prepare the shots.** Say **Prepare EP01** (or **prepare_unit**). Claude:
- breaks the unit into shots with your Shotlist skill: shots for an episode or scene; usually one generation per shot for an ad
- proposes blocking for multi-character shots, for you to approve
- writes every Seedance prompt with CINEDANCE + Acting

It skips **CONTINUATION** shots for now, because they start from the previous shot's last frame. They're written once that shot is approved.

**4. Generate.** Say **Queue EP01**. Generation starts in the background and stops by itself when the queue is empty. It keeps going even if you close the chat. Ask *How's the worker doing?* for progress, or *Stop the worker* to stop. (Installed with the terminal installer instead? Double-click **Start worker** in the projects folder, or run `uv run worker.py`.)

**5. Review.** Say **Review EP01** (or **review_unit**). Watch each video, then say *approve* or *retry: what's wrong*. Claude patches the weak part of the prompt, writes the continuation shots that are now possible, and re-queues. Repeat 4 → 5 until the unit is at 100%.

**6. Export.** Say **Export EP01**. You get `EP01_ROUGHCUT.mp4`, `EP01_ROUGHCUT.edl` (import into Premiere or Resolve with the `approved/` folder as media) and `EP01_manifest.json`.

---

## Keeping costs under control

- Test new looks at **480p** and short durations first (`update_shot` → `resolution`).
- `max_attempts` (default 3) caps spending per shot. Raise it per shot only when it's worth it.
- `--concurrency 2` is gentle. Raise it once things are reliable.
- Generated videos are only charged when they succeed, but every retry is a new generation.

---

## Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| `ARK_API_KEY is not set` | The terminal or config is missing the key | Part C step 2, or the `env` block in Part E |
| `HTTP 401` | Wrong or expired key | Copy the key again from the console |
| `HTTP 400 ... model` | Model not activated or wrong ID | Activate it in ModelArk and copy the exact ID |
| `HTTP 400` naming a field (`role`, `ratio`, …) | The API wants a different field | Paste the error to Claude Code. For `role`, try `SEEDANCE_IMAGE_ROLES=0` |
| `Could not reach BytePlus` | Internet or firewall problem | Check your connection. Requeue the episode, since failed shots go back in the queue |
| Shot is `failed` | Submission was refused; no credits spent | `get_shot` shows the error. Fix it, then say *Queue EP01* again |
| Claude says the project type isn't set | The project hasn't been started yet | Say *Start a new project* |
| `… image assets are waiting for images` | Prompt sheet written, images not added yet | Add the images (Part G step 2), then say *I've added the images* |
| `continues from …, which has no last frame` | A continuation shot is waiting on the previous shot | Approve the previous shot first |
| `Reference image not found` | Wrong path, or the image was moved | Fix the file or path, then re-save the prompt |
| `is X MB; keep reference images under 10 MB` | Image too big to send | Export a smaller JPG |
| `Video download failed … links expire` | You checked a job too late | Regenerate. Keep the worker running so downloads happen right away |
| `timeout` on a shot | BytePlus didn't finish within 2 hours | It retries automatically within budget |
| Claude Desktop doesn't list the tools | Config path or JSON is wrong | Read the server log under Settings → Developer |

When something breaks that isn't in this table, run `uv run pytest -q`. If the tests still pass, the problem is in your setup or the real API, not the code. Paste the exact error to Claude Code.
