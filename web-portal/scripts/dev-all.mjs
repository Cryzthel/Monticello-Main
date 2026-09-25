/**
 * Starts BOTH portal dev servers in parallel.
 *
 * `npm run dev --workspaces` would not do this: npm runs workspace scripts
 * SERIALLY, so it starts the admin server, blocks on it forever, and never
 * reaches the guardhouse one — leaving you with a half-running pair and no
 * indication that is what happened.
 *
 * Written against node:child_process rather than adding `concurrently`: two
 * spawns and a signal handler is not worth a dependency, and this keeps the
 * install surface of a security-sensitive console smaller.
 */
import { spawn } from 'node:child_process'

const APPS = [
  { name: 'admin', workspace: '@monticello/admin-portal', port: 3000 },
  { name: 'security', workspace: '@monticello/security-portal', port: 3001 },
]

const children = APPS.map(({ name, workspace, port }) => {
  console.log(`[${name}] starting on http://localhost:${port}`)

  // shell:true is required on Windows: `npm` is npm.cmd, and since the Node
  // 18.20 / 20.12 security fix a bare spawn of a .cmd file throws EINVAL.
  //
  // The command is passed as ONE string rather than a command plus an args
  // array, because that pairing with shell:true is what triggers DEP0190 (the
  // args are concatenated, not escaped). Every part here is a literal from the
  // APPS table above — nothing reaches this line from a user, a file or an
  // environment variable — so there is nothing to escape.
  const child = spawn(`npm run dev -w ${workspace}`, {
    stdio: 'inherit',
    shell: true,
  })

  child.on('exit', (code) => {
    // One server dying leaves the pair in exactly the half-running state this
    // script exists to prevent, so take the other down with it rather than
    // pretending both portals are up.
    console.error(`[${name}] exited with code ${code}; stopping the other portal.`)
    shutdown(code ?? 1)
  })

  return child
})

let shuttingDown = false
function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill()
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
