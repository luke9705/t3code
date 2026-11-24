# Network calls T3 Code makes

T3 Code sends no product analytics, crash reports, or traces anywhere. Nothing leaves your machine
except the traffic you or your tools create:

- **Provider traffic**: your prompts, replies, and file context go to the model providers you
  configure (Anthropic, OpenAI, and so on), under their own privacy policies.
- **T3 Connect**: when you link environments, traffic rides a Cloudflare tunnel (`cloudflared` on
  your machine) through the T3 Connect relay. The relay sets up the link; it does not proxy your
  HTTP or WebSocket sessions.
- **Model catalog updates** from `raw.githubusercontent.com` (the T3 Code repository), about once
  an hour while provider status is checked, and again after a provider update or a model cache
  refresh. **Provider update checks** also look up newer provider CLI versions on the npm registry.
  Turn both off with **Settings > Maintenance > Provider update checks**; new models may then not
  appear until you update T3 Code.
- **Model prices** from LiteLLM's public price table on `raw.githubusercontent.com` (falling back
  to `api.github.com`), at most once a day, when you open **Usage**. Prices are cached on disk.
  There is no switch; if you never open Usage, it is never fetched.
- **T3 Code release lookups** on the npm registry (or your configured npm registry) when you open
  the dialog to switch update tracks.
- **Desktop app updates**: packaged desktop builds with an update feed check it 15 seconds after
  start and every 4 minutes. Set `T3CODE_DISABLE_AUTO_UPDATE=1` to turn this off.

Diagnostics such as process CPU and memory history, server logs, and crash logs from the mobile
app's **Settings > Diagnostics** screen stay on your devices until you copy or share them yourself.
