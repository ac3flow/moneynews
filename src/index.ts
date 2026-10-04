import { handleApi } from './api';
import { runPipeline, stagesForCron } from './pipeline/run';
import type { Env } from './types';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    // wrangler.jsonc routes only /api/* here; anything else is a static asset.
    if (pathname.startsWith('/api/')) return handleApi(req, env);
    return env.ASSETS.fetch(req);
  },

  // Staged mode: five triggers a minute apart, each running its slice of
  //   Research -> Edit -> Fact-Check -> Translate (KA) -> Georgian Grammar -> Publish/Reject.
  // Single mode: one */5 trigger runs all of it. See PIPELINE_MODE in wrangler.jsonc.
  // The run is awaited: a cron invocation may take up to 15 minutes of wall time, while work left to waitUntil()
  // is cut off 30 seconds after the handler returns, which is shorter than two model calls.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const stages = stagesForCron(env.PIPELINE_MODE, controller.cron);
    await runPipeline(env, { trigger: 'cron', stages })
      .then((r) => console.log('pipeline', stages.join('+'), r.status, JSON.stringify(r.stages)))
      .catch((e) => console.error('pipeline FAILED:', e instanceof Error ? e.message : e));
  },
} satisfies ExportedHandler<Env>;
