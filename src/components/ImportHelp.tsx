import jsonExample from '../../docs/formats/cards.example.json'
import csvExample from '../../docs/formats/cards.example.csv?raw'
import { t } from '../lib/i18n'

export function ImportHelp({ onBack }: { onBack: () => void }) {
  function download(kind: 'csv' | 'json') {
    const text = kind === 'csv' ? '\ufeff' + csvExample : JSON.stringify(jsonExample, null, 2)
    const url = URL.createObjectURL(new Blob([text], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `vibe-word-cards-example.${kind}`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <article className="app-surface min-w-0 p-5 sm:p-6" aria-labelledby="import-help-title">
      <header className="flex items-center justify-between gap-4"><h2 id="import-help-title" className="text-xl font-bold">{t('帮助与导入格式')}</h2><button className="btn-secondary" onClick={onBack}>{t('返回')}</button></header>
      <div className="space-y-7 mt-6 text-sm leading-7">
        <section><h3 className="section-title">选择导入方式</h3><ul className="list-disc pl-5">
          <li><strong>添加 → 导入文件 → 文档生成：</strong>PDF、DOCX、TXT、TEXT、Markdown、CSV 作为学习资料，调用模型生成草稿，再审核接受。纯文本不要求图片输入能力；PDF/Word 需要支持图片输入的模型。</li>
          <li><strong>添加 → 导入文件：</strong>CSV / JSON / JSONL 先校验卡片格式，符合规范的卡片直接入库，不调用模型、不生成反向卡；不符合卡片格式则进入智能分析。JSONL 每行是一个包含 id、front、back 的卡片对象。相同 ID 更新已有卡片，保留学习进度；相同文件中的重复 ID 会报错。已删除 ID 不可重用，恢复请换新 ID。</li>
        </ul></section>
        <section><h3 className="section-title">TXT 与普通 CSV 学习材料</h3><p>文本使用 UTF-8（允许 BOM）。TXT / TEXT / Markdown 按空行分段，无固定字段。CSV 第一条记录必须是非空且不重复的表头，每条数据列数必须一致；可使用任意业务字段，例如 word、meaning、example。</p><p>文档导入最多 20 MB、30 万文字；PDF/Word 最多 100 页。CSV 使用英文逗号分隔，不支持分号或制表符分隔。Excel 请另存为「CSV UTF-8」。</p></section>
        <section><h3 className="section-title">卡片 CSV / JSON 字段</h3><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>字段</th><th>要求</th><th>含义</th></tr></thead><tbody>
          <tr><td>id</td><td>必填字符串</td><td>稳定且唯一，最多 512 个 UTF-8 字节；建议如 my-vocabulary:cue。</td></tr>
          <tr><td>front</td><td>必填非空字符串</td><td>卡片正面。</td></tr>
          <tr><td>back</td><td>必填字符串</td><td>卡片背面，支持 Markdown，可为空字符串。</td></tr>
          <tr><td>example</td><td>可选字符串</td><td>例句；CSV 可留空，JSON 可省略或为 null。</td></tr>
          <tr><td>createdAt</td><td>可选非负数字</td><td>Unix 时间戳，单位秒；CSV 可留空，JSON 可省略或为 null。不是毫秒或日期字符串。</td></tr>
        </tbody></table></div></section>
        <section><h3 className="section-title">卡片 CSV 格式</h3><p>表头必须包含 id、front、back；可增加 example、createdAt，顺序不限，区分大小写，不支持其他列。最多 100000 条卡片、20 MB。含逗号、双引号或换行的字段必须用双引号包围；字段内部的一个双引号写成两个双引号，例如 <code>"say ""hello"""</code>。下方 back 字段的换行是同一张卡片的一部分。</p><pre className="overflow-auto rounded-xl bg-slate-100 p-4 text-xs leading-6 whitespace-pre">{csvExample}</pre><button className="btn-secondary mt-3" onClick={() => download('csv')}>下载 CSV 示例</button></section>
        <section><h3 className="section-title">卡片 JSON 格式</h3><p>顶层必须是对象，包含 <code>format: "vibe-word.cards"</code>、<code>version: 1</code> 和 <code>cards</code> 数组（最多 100000 条）。每条卡片使用上述字段。必须是合法 JSON，不能有注释、尾随逗号或 Markdown 代码围栏。字符串换行写成 <code>\n</code>。可在卡片页使用「导出卡片 JSON」获得可再次导入的文件。</p><pre className="overflow-auto rounded-xl bg-slate-100 p-4 text-xs leading-6">{JSON.stringify(jsonExample, null, 2)}</pre><button className="btn-secondary mt-3" onClick={() => download('json')}>下载 JSON 示例</button></section>
        <p className="section-copy">导入会先检查整个文件；格式不正确时会报错，请修正后重试。CSV / JSON 是卡片交换格式，不包含 API Key 或完整复习历史。</p>
      </div>
  </article>
}
