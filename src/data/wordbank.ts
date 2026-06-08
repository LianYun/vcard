// Built-in starter wordbank. Static, read-only — these cards are part of the app
// code and cannot be edited or deleted by the user. Users add their own cards
// through the Add Card page (stored in localStorage via cardStore).
//
// Intentionally small to keep the repo light; users are expected to add words.

import type { Card } from '../types'

export const WORD_BANK: Card[] = [
  { id: 'builtin:abandon', front: 'abandon', back: 'vt. 放弃；抛弃', example: 'He abandoned his car on the highway.' },
  { id: 'builtin:absolute', front: 'absolute', back: 'adj. 绝对的；完全的', example: 'I have absolute confidence in her.' },
  { id: 'builtin:accurate', front: 'accurate', back: 'adj. 准确的；精确的', example: 'The clock keeps accurate time.' },
  { id: 'builtin:achieve', front: 'achieve', back: 'v. 实现；达到', example: 'You can achieve your goals with hard work.' },
  { id: 'builtin:adapt', front: 'adapt', back: 'v. 适应；改编', example: 'She adapted quickly to the new environment.' },
  { id: 'builtin:benefit', front: 'benefit', back: 'n. 利益 v. 受益', example: 'Regular exercise benefits your health.' },
  { id: 'builtin:capable', front: 'capable', back: 'adj. 有能力的', example: 'She is capable of solving any problem.' },
  { id: 'builtin:challenge', front: 'challenge', back: 'n./v. 挑战', example: 'Learning a language is a challenge.' },
  { id: 'builtin:diligent', front: 'diligent', back: 'adj. 勤奋的', example: 'He is a diligent student.' },
  { id: 'builtin:efficient', front: 'efficient', back: 'adj. 高效的', example: 'This is a very efficient method.' },
  { id: 'builtin:encourage', front: 'encourage', back: 'v. 鼓励', example: 'My teacher encouraged me to try again.' },
  { id: 'builtin:familiar', front: 'familiar', back: 'adj. 熟悉的', example: 'This song sounds familiar to me.' },
  { id: 'builtin:gather', front: 'gather', back: 'v. 收集；聚集', example: 'We gathered around the fire.' },
  { id: 'builtin:honest', front: 'honest', back: 'adj. 诚实的', example: 'Be honest with yourself.' },
  { id: 'builtin:imitate', front: 'imitate', back: 'v. 模仿', example: 'Children often imitate their parents.' },
  { id: 'builtin:journey', front: 'journey', back: 'n. 旅程', example: 'Life is a long journey.' },
  { id: 'builtin:knowledge', front: 'knowledge', back: 'n. 知识', example: 'Knowledge is power.' },
  { id: 'builtin:launch', front: 'launch', back: 'v. 发起；发射', example: 'They will launch a new product.' },
  { id: 'builtin:method', front: 'method', back: 'n. 方法', example: 'We need a new method to solve this.' },
  { id: 'builtin:obvious', front: 'obvious', back: 'adj. 明显的', example: 'The answer is obvious.' },
]
