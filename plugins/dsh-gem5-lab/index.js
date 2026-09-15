import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'gem5-lab-tools'
export const inject = ['tools']

export const Config = Schema.object({
  projectRoot: Schema.string().required(),
  pythonExecutable: Schema.string().required(),
  dashboardUrl: Schema.string().required(),
  commandTimeoutMs: Schema.number().min(1000).default(86400000),
})

function boundedPath(root, relativePath) {
  const resolved = path.resolve(root, relativePath)
  const prefix = `${path.resolve(root)}${path.sep}`
  if (resolved !== path.resolve(root) && !resolved.startsWith(prefix)) {
    throw new Error(`Path escapes gem5-lab project: ${relativePath}`)
  }
  return resolved
}

function runProcess(executable, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let size = 0
    const append = (target, chunk) => {
      size += chunk.length
      if (size > 4 * 1024 * 1024) {
        child.kill('SIGTERM')
        reject(new Error('gem5-lab command output exceeded 4 MiB'))
        return
      }
      target.push(chunk)
    }
    child.stdout.on('data', chunk => append(stdout, chunk))
    child.stderr.on('data', chunk => append(stderr, chunk))
    const stop = () => child.kill('SIGTERM')
    options.signal.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs)
    child.on('error', reject)
    child.on('close', code => {
      clearTimeout(timer)
      options.signal.removeEventListener('abort', stop)
      const output = Buffer.concat(stdout).toString('utf8').trim()
      const errorOutput = Buffer.concat(stderr).toString('utf8').trim()
      if (code !== 0) {
        reject(new Error(`gem5-lab exited ${code}: ${errorOutput || output}`))
        return
      }
      resolve({ output, errorOutput })
    })
  })
}

async function apiJson(baseUrl, endpoint, init, signal) {
  const response = await fetch(`${baseUrl}${endpoint}`, { ...init, signal })
  const body = await response.text()
  if (!response.ok) throw new Error(`gem5-lab API ${response.status}: ${body}`)
  return JSON.parse(body)
}

const objectOutput = {
  schema: { type: 'object', additionalProperties: true, properties: {} },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

export function apply(ctx, config) {
  const cli = [config.pythonExecutable, '-m', 'gem5_lab.cli']
  const environment = { ...process.env, GEM5_LAB_DB: path.join(config.projectRoot, 'var/gem5-lab.db') }

  ctx.tools.register(defineTool({
    name: 'gem5_lab_run_experiment',
    description: 'Run the autonomous Ruby optimization loop from a reviewed JSON experiment spec. Fixed hardware parameters are never changed. The loop records every trial and stops on target, convergence, search exhaustion, or budget.',
    parameters: {
      spec_path: { type: 'string', required: true, description: 'Path relative to gem5-lab, for example examples/demo-experiment.json.' },
    },
    output: objectOutput,
    async execute(args, exec) {
      const specPath = boundedPath(config.projectRoot, args.spec_path)
      const result = await runProcess(cli[0], [...cli.slice(1), '--db', 'var/gem5-lab.db', 'run-synthetic', specPath], {
        cwd: config.projectRoot, env: environment, signal: exec.signal, timeoutMs: config.commandTimeoutMs,
      })
      return JSON.parse(result.output)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gem5_lab_experiment_status',
    description: 'Read live optimization state from the gem5-lab dashboard API. Omit experiment_id to list all experiments.',
    parameters: { experiment_id: { type: 'string', description: 'Experiment identifier returned by gem5_lab_run_experiment.' } },
    output: objectOutput,
    async execute(args, exec) {
      const endpoint = args.experiment_id
        ? `/api/experiments/${encodeURIComponent(args.experiment_id)}`
        : '/api/experiments'
      return { dashboard_url: config.dashboardUrl, data: await apiJson(config.dashboardUrl, endpoint, {}, exec.signal) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gem5_lab_submit_event',
    description: 'Submit one standard Loop Agent event to gem5-lab. Use this for external GKB or lmbench workers so intermediate results update the dashboard immediately.',
    parameters: { event_json: { type: 'string', required: true, description: 'A complete JSON event envelope with event_id, experiment_id, event_type, emitted_at, and payload.' } },
    output: objectOutput,
    async execute(args, exec) {
      let event
      try { event = JSON.parse(args.event_json) } catch (error) { throw new Error(`Invalid event_json: ${error.message}`) }
      return apiJson(config.dashboardUrl, '/api/events', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event),
      }, exec.signal)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'gem5_lab_optimization_contract',
    description: 'Read the authoritative Loop Agent prompt plus fixed, search-space, and benchmark configuration locations before changing or testing Ruby parameters.',
    parameters: {},
    output: objectOutput,
    async execute(_args, exec) {
      if (exec.signal.aborted) throw new Error('Operation cancelled')
      const promptPath = boundedPath(config.projectRoot, 'configurations/loop-agent/loop-agent-prompt.md')
      const prompt = await readFile(promptPath, 'utf8')
      return {
        project_root: config.projectRoot,
        prompt_path: promptPath,
        manual_confirmed: boundedPath(config.projectRoot, 'configurations/loop-agent/manual-confirmed.yaml'),
        search_space: boundedPath(config.projectRoot, 'configurations/loop-agent/search-space.yaml'),
        baseline: boundedPath(config.projectRoot, 'configurations/loop-agent/baseline.yaml'),
        dashboard_url: config.dashboardUrl,
        instructions: prompt,
      }
    },
  }))
}
