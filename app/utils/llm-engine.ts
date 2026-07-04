import type { InitProgressReport, MLCEngine } from '@mlc-ai/web-llm'

export type ChatRole = 'system' | 'user'

export interface ChatMessage {
  role: ChatRole
  content: string
}

const MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'

let enginePromise: Promise<MLCEngine> | null = null
let progressCallback: ((progress: InitProgressReport) => void) | null = null

export function isLlmSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

async function getEngine(): Promise<MLCEngine> {
  if (!enginePromise) {
    enginePromise = import('@mlc-ai/web-llm').then(({ CreateMLCEngine }) =>
      CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (report) => progressCallback?.(report)
      })
    )
  }

  return enginePromise
}

export async function completeChatJson(
  messages: ChatMessage[],
  jsonSchema: string,
  onProgress?: (progress: number) => void
): Promise<string> {
  progressCallback = onProgress ? (report) => onProgress(report.progress) : null

  try {
    const engine = await getEngine()
    progressCallback = null

    const response = await engine.chat.completions.create({
      messages,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: 'json_object', schema: jsonSchema }
    })

    return response.choices[0]?.message?.content ?? ''
  }
  finally {
    progressCallback = null
  }
}
