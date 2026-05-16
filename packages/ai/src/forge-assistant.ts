import { anthropic, FORGE_MODEL } from './client'

const SYSTEM_PROMPT = `Tu es FORGE AI, l'assistant intelligent intégré dans l'ERP FORGE de TAFDIL.
TAFDIL est une microusine métallurgique basée à Douala, Cameroun.
Tu aides les opérateurs avec la gestion de production, les commandes, l'inventaire et les analyses.
Réponds toujours en français. Sois concis, pratique et orienté action.
La devise utilisée est le FCFA (XAF).`

export async function askForgeAI(
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [],
): Promise<string> {
  const response = await anthropic.messages.create({
    model: FORGE_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ],
  })

  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
  return block.text
}
