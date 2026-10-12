# Terminal demo for the README. Re-record from the repo root:
#   vhs docs/demo/commands.tape
# Needs: the db service running (docker compose up -d db) and port 3100 free.
# Long commands run hidden and their output is shown at once, to keep the GIF short.

Output docs/demo/commands.gif

Set Shell "bash"
Set FontSize 15
Set Width 1280
Set Height 760
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WaitTimeout 600s
Set WaitPattern /tyntro \$/

Hide
Type "export PS1='tyntro $ ' NEXT_TELEMETRY_DISABLED=1 && clear"
Enter
Show

Type "# 1. Install dependencies and create .env (keeps an existing one)"
Enter
Type "npm ci --no-audit --no-fund --loglevel=error && cp -n .env.example .env"
Enter
Hide
Wait
Show
Sleep 2s

Type "# 2. Start PostgreSQL, apply migrations, seed challenges"
Enter
Type "docker compose up -d db"
Enter
Wait
Sleep 1s
Type "npx prisma migrate deploy"
Enter
Wait
Sleep 1s
Type "npm run seed"
Enter
Wait
Sleep 2s
Type "clear"
Enter

Type "# 3. Quality gates: typecheck, tests, production build"
Enter
Type "npm run typecheck"
Enter
Wait
Sleep 1s
Type "npm test 2>&1 | tail -n 9"
Enter
Hide
Wait
Show
Sleep 3s
Type "clear"
Enter
Type "npm run build 2>&1 | tail -n 22"
Enter
Hide
Wait
Show
Sleep 4s
Type "clear"
Enter

Type "# 4. Dev server (the worker runs the same way: npm run worker)"
Enter
Type "npm run dev -- -p 3100 -H 127.0.0.1"
Enter
Wait+Screen /Ready in/
Sleep 1s
Ctrl+C
Wait
Sleep 1s
Type "clear"
Enter

Type "# 5. Full stack in Docker: db + migrate + web + worker"
Enter
Type "docker compose up -d"
Enter
Hide
Wait
Show
Sleep 1s
Type "docker compose ps --format 'table {{.Service}}\t{{.Status}}'"
Enter
Wait
Sleep 1s
Type "curl -s localhost:3000/api/health; echo"
Enter
Wait
Sleep 4s
