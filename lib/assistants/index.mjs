import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readTestConfigIn, secretVariables } from '../test-config.mjs';
import { withoutVariables } from '../util/env.mjs';
import { runProcess } from '../util/process.mjs';
import { resolveCommand } from '../util/which.mjs';
import claude from './claude.mjs';
import codex from './codex.mjs';
import copilot from './copilot.mjs';
import { AssistantError, unique } from './shared.mjs';

export { AssistantError };

/** Adapter specs by assistant name. */
export const ADAPTERS = Object.freeze({ claude, copilot, codex });

/** Model roles: generate writes checks, analyze proposes fixes, testDriver drives the subject under test. */
export const ROLES = Object.freeze(['generate', 'analyze', 'testDriver']);

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function prepare(request, models) {
  if (!request?.promptFile) throw new AssistantError('An assistant run needs a prompt file.');
  const promptFile = path.resolve(request.promptFile);
  if (!existsSync(promptFile)) throw new AssistantError(`Prompt file not found: ${promptFile}`);
  const role = request.role ?? 'generate';
  if (!ROLES.includes(role)) throw new AssistantError(`Unknown model role "${role}". Use one of ${ROLES.join(', ')}.`);
  return {
    ...request,
    role,
    promptFile,
    prompt: readFileSync(promptFile, 'utf8'),
    cwd: path.resolve(request.cwd ?? process.cwd()),
    model: request.model ?? (models[role] || undefined),
    effort: request.effort ?? (models.effort || undefined),
    autoTier: request.autoTier ?? (role === 'testDriver' ? models.testDriverAutoTier : undefined),
    attachments: (request.attachments ?? []).map((file) => path.resolve(file)),
    addDirs: unique([path.dirname(promptFile), ...(request.addDirs ?? []).map((dir) => path.resolve(dir))]),
    outputFile: request.outputFile ? path.resolve(request.outputFile) : undefined,
    timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/**
 * Creates the adapter for one assistant from the auto-check settings.
 *
 * A request names a prompt file and may add: role (generate, analyze, or
 * testDriver, which picks the configured model), model, effort, cwd,
 * addDirs, attachments, outputFile, timeoutMs, structured, sessionName,
 * sessionId, resume, and transcriptFile. `fakeBinary` runs a Node script in
 * place of the real command, for tests. The assistant starts without the
 * variables that hold notification secrets: the settings' ones, and the ones
 * the test-configuration.md of `testFolder` names.
 */
export function createAssistant(name, { config, fakeBinary, env = process.env, testFolder = null } = {}) {
  const spec = ADAPTERS[name];
  if (!spec) throw new AssistantError(`Unknown assistant "${name}". Use one of ${Object.keys(ADAPTERS).join(', ')}.`);
  const settings = config.assistants[name];
  const models = config.models[name];
  const locate = () => (fakeBinary ? { file: process.execPath, args: [path.resolve(fakeBinary)] } : resolveCommand(spec.command, env));
  const plan = (request) => {
    const prepared = prepare(request, models);
    return { prepared, ...spec.build(prepared, settings) };
  };

  return {
    name,
    label: spec.label,
    command: spec.command,
    permissionMode: settings.permissionMode,
    models: { ...models },
    available: () => locate() !== null,
    /** The arguments and stdin text a run would use, without starting anything. */
    plan,
    /** Runs the assistant and resolves with its exit code, output, and session id. */
    async run(request) {
      const launcher = locate();
      if (!launcher) throw new AssistantError(`${spec.label} is not available: "${spec.command}" is not on PATH.`);
      const { prepared, args, input } = plan(request);
      const testConfig = testFolder ? readTestConfigIn(testFolder) : null;
      const hidden = secretVariables({ testConfig, notify: config.notify });
      const childEnv = withoutVariables(spec.environment ? spec.environment(env) : env, hidden);
      const result = await runProcess({ launcher, args, input, cwd: prepared.cwd, timeoutMs: prepared.timeoutMs, env: childEnv });
      if (result.error) throw new AssistantError(`${spec.label} could not start: ${result.error.message}`);
      if (prepared.outputFile) {
        mkdirSync(path.dirname(prepared.outputFile), { recursive: true });
        writeFileSync(prepared.outputFile, result.stdout);
      }
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        outputPath: prepared.outputFile ?? null,
        sessionId: spec.sessionIdFrom(result.stdout) ?? prepared.sessionId ?? null,
      };
    },
  };
}

/** The adapter for the assistant the configuration selects, or for `name` when given. */
export function assistantFor(config, { name = config.assistant, ...options } = {}) {
  return createAssistant(name, { config, ...options });
}
