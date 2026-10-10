//! Read-only, bounded APKG reader. No archive paths are ever extracted verbatim.
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs::{self, File}, io::{Read, Write}, path::Path};
static CANCELLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[tauri::command]
pub fn cancel_anki() { CANCELLED.store(true, std::sync::atomic::Ordering::SeqCst); }
fn check_cancelled() -> Result<()> { if CANCELLED.load(std::sync::atomic::Ordering::SeqCst) { Err("已取消解析".into()) } else { Ok(()) } }
const MAX: u64 = 512 * 1024 * 1024;
type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
fn hash(data: &[u8]) -> String { format!("{:x}", Sha256::digest(data)) }
fn bytes(zip: &mut zip::ZipArchive<File>, name: &str, compressed: bool, limit: u64) -> Result<Vec<u8>> {
    check_cancelled()?;
    let entry = zip.by_name(name)?;
    if entry.size() > limit { return Err("Anki 文件条目过大".into()); }
    let mut reader: Box<dyn Read + '_> = if compressed { Box::new(zstd::stream::read::Decoder::new(entry)?) } else { Box::new(entry) };
    let mut out = Vec::new(); reader.by_ref().take(limit + 1).read_to_end(&mut out)?;
    if out.len() as u64 > limit { return Err("Anki 解压数据超出限制".into()); } Ok(out)
}
// Minimal protobuf wire reader, for the documented metadata/config records only.
fn varint(data: &[u8], pos: &mut usize) -> Result<u64> {
    let mut value = 0; for shift in (0..70).step_by(7) {
        let byte = *data.get(*pos).ok_or("损坏的 protobuf")?; *pos += 1;
        if shift == 63 && byte > 1 { return Err("protobuf 整数溢出".into()); }
        value |= ((byte & 127) as u64) << shift;
        if byte < 128 { return Ok(value); }
    } Err("protobuf 整数溢出".into())
}
fn proto(data: &[u8]) -> Result<Vec<(u64, Vec<u8>, u64)>> {
    let mut out = Vec::new(); let mut pos = 0;
    while pos < data.len() {
        let key = varint(data, &mut pos)?; let field = key >> 3;
        match key & 7 {
            0 => out.push((field, vec![], varint(data, &mut pos)?)),
            2 => { let size = usize::try_from(varint(data, &mut pos)?)?; let end = pos.checked_add(size).ok_or("protobuf 长度溢出")?;
                let value = data.get(pos..end).ok_or("protobuf 长度无效")?.to_vec(); pos = end; out.push((field, value, 0)); }
            1 | 5 => { pos += if key & 7 == 1 { 8 } else { 4 }; if pos > data.len() { return Err("protobuf 截断".into()); } }
            _ => return Err("不支持的 protobuf wire type".into())
        }
    } Ok(out)
}
fn string_field(data: &[u8], id: u64) -> Result<String> { Ok(proto(data)?.into_iter().find(|f| f.0 == id).map(|f| String::from_utf8(f.1)).transpose()?.unwrap_or_default()) }
fn integer_field(data: &[u8], id: u64) -> Result<u64> { Ok(proto(data)?.into_iter().find(|f| f.0 == id).map(|f| f.2).unwrap_or(0)) }
fn parse(path: &Path, stage: &Path) -> Result<()> {
    if fs::metadata(path)?.len() > MAX { return Err("Anki 包超过 512 MB".into()); }
    let mut zip = zip::ZipArchive::new(File::open(path)?)?;
    if zip.len() > 100_000 { return Err("Anki 包文件数过多".into()); }
    let modern = if zip.index_for_name("meta").is_some() {
        let version = integer_field(&bytes(&mut zip,"meta",false,1024)?, 1)?;
        if !(1..=3).contains(&version) { return Err("未知 Anki 包版本，请更新应用".into()); } version == 3
    } else { false };
    let db_name = if modern { "collection.anki21b" } else if zip.index_for_name("collection.anki21").is_some() { "collection.anki21" } else { "collection.anki2" };
    fs::create_dir_all(stage.join("media"))?;
    let db_bytes = bytes(&mut zip, db_name, modern, MAX)?;
    let db_path = stage.join("collection.sqlite"); File::create(&db_path)?.write_all(&db_bytes)?;
    let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    conn.execute_batch("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;")?;
    let version: i64 = conn.query_row("SELECT ver FROM col", [], |r| r.get(0))?;
    if version != 11 && version != 18 { return Err(format!("暂不支持 Anki 数据库版本 {version}").into()); }
    let mut models = BTreeMap::<String,Value>::new(); let mut decks = BTreeMap::<String,String>::new();
    if version == 11 {
        let (m,d): (String,String) = conn.query_row("SELECT models,decks FROM col",[],|r|Ok((r.get(0)?,r.get(1)?)))?;
        let raw: Value = serde_json::from_str(&m)?;
        for (id,m) in raw.as_object().ok_or("笔记类型无效")? {
            models.insert(id.clone(),json!({"name":m["name"],"kind":m["type"],"css":m["css"],"fields":m["flds"],"templates":m["tmpls"]}));
        }
        let raw: Value = serde_json::from_str(&d)?;
        for (id,d) in raw.as_object().ok_or("牌组无效")? { decks.insert(id.clone(),d["name"].as_str().unwrap_or("Default").into()); }
    } else {
        let mut stmt = conn.prepare("SELECT id,name,config FROM notetypes")?;
        for row in stmt.query_map([],|r| Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,Vec<u8>>(2)?)))? {
            let (id,name,config) = row?;
            let mut f = conn.prepare("SELECT ord,name FROM fields WHERE ntid=? ORDER BY ord")?;
            let fields = f.query_map([id],|r|Ok(json!({"ord":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
            let mut t = conn.prepare("SELECT ord,name,config FROM templates WHERE ntid=? ORDER BY ord")?;
            let mut templates = vec![];
            for row in t.query_map([id],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,Vec<u8>>(2)?)))? {
                let (ord,name,c) = row?; templates.push(json!({"ord":ord,"name":name,"qfmt":string_field(&c,1)?,"afmt":string_field(&c,2)?}));
            }
            models.insert(id.to_string(),json!({"name":name,"kind":integer_field(&config,1)?,"css":string_field(&config,3)?,"fields":fields,"templates":templates}));
        }
        let mut stmt = conn.prepare("SELECT id,name FROM decks")?;
        for row in stmt.query_map([],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?)))? { let (id,name)=row?; decks.insert(id.to_string(),name.replace('\u{1f}',"::")); }
    }
    let count: i64 = conn.query_row("SELECT count(*) FROM cards",[],|r|r.get(0))?;
    if count > 100_000 { return Err("牌组超过 100000 张卡片，请拆分导出".into()); }
    let mut stmt = conn.prepare("SELECT n.guid,n.mid,n.flds,n.tags,c.ord,CASE WHEN c.odid != 0 THEN c.odid ELSE c.did END,c.id FROM cards c JOIN notes n ON n.id=c.nid ORDER BY c.id")?;
    let rows = stmt.query_map([],|r|Ok(json!({"guid":r.get::<_,String>(0)?,"model":r.get::<_,i64>(1)?.to_string(),"values":r.get::<_,String>(2)?.split('\u{1f}').collect::<Vec<_>>(),"tags":r.get::<_,String>(3)?.split_whitespace().collect::<Vec<_>>(),"ord":r.get::<_,i64>(4)?,"deck":r.get::<_,i64>(5)?.to_string(),"sourceId":r.get::<_,i64>(6)?.to_string()})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let mut media = BTreeMap::<String,String>::new(); let mut warnings = vec![]; let mut total = db_bytes.len() as u64;
    if zip.index_for_name("media").is_some() {
        let data = bytes(&mut zip,"media",modern,32_000_000)?;
        let entries: Vec<(String,String)> = if modern {
            proto(&data)?.into_iter().filter(|f|f.0==1).enumerate().map(|(index,(_,data,_))| Ok((index.to_string(),string_field(&data,1)?))).collect::<Result<_>>()?
        } else { serde_json::from_slice::<BTreeMap<String,String>>(&data)?.into_iter().collect() };
        for (index,name) in entries {
            check_cancelled()?;
            if !index.chars().all(|c| c.is_ascii_digit()) { return Err("媒体索引无效".into()); }
            let ext = Path::new(&name).extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase();
            if !["png","jpg","jpeg","gif","webp","mp3","wav","ogg","m4a","aac","flac","opus"].contains(&ext.as_str()) { warnings.push(format!("不支持的附件：{name}")); continue; }
            if zip.index_for_name(&index).is_none() { warnings.push(format!("附件缺失：{name}")); continue; }
            let data = bytes(&mut zip,&index,modern,32_000_000)?; total += data.len() as u64;
            if total > 2*1024*1024*1024 { return Err("解压内容超过 2 GB".into()); }
            let id = format!("{}.{}",hash(&data),ext); fs::write(stage.join("media").join(&id),&data)?; media.insert(name,id);
        }
    }
    let result = json!({"name":path.file_stem().and_then(|v|v.to_str()).unwrap_or("Anki"),"models":models,"decks":decks,"cards":rows,"media":media,"warnings":warnings});
    let data = serde_json::to_vec(&result)?;
    if data.len() > 128*1024*1024 { return Err("Anki 索引超过 128 MB".into()); }
    fs::write(stage.join("raw.json"),data)?; Ok(())
}
#[tauri::command]
pub async fn inspect_anki() -> std::result::Result<Value,String> {
    CANCELLED.store(false,std::sync::atomic::Ordering::SeqCst);
    let selected = crate::cloud::cloud_storage("chooseAnki".into(),None).await?;
    if selected.is_null() { return Ok(Value::Null); }
    let path = selected["path"].as_str().ok_or("文件选择失败")?.to_owned();
    let stage = selected["stage"].as_str().ok_or("临时目录失败")?.to_owned();
    let target = stage.clone();
    let result = tauri::async_runtime::spawn_blocking(move || parse(Path::new(&path),Path::new(&target)).map_err(|e|e.to_string())).await.map_err(|e|e.to_string())?;
    if let Err(error) = result { let _ = fs::remove_dir_all(&stage); return Err(error); }
    crate::cloud::cloud_storage("prepareAnki".into(),Some(json!({"stage":stage}))).await
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn official_fixtures() {
        if let Ok(root) = std::env::var("ANKI_FIXTURES") {
            for name in ["legacy", "modern"] {
                let dir = tempfile::tempdir().unwrap();
                parse(&Path::new(&root).join(format!("{name}.apkg")),dir.path()).unwrap();
                let raw: Value = serde_json::from_slice(&fs::read(dir.path().join("raw.json")).unwrap()).unwrap();
                assert_eq!(raw["cards"].as_array().unwrap().len(),3);
                assert_eq!(raw["media"].as_object().unwrap().len(),2);
                fs::write(Path::new(&root).join(format!("{name}-raw.json")),serde_json::to_vec(&raw).unwrap()).unwrap();
                let output = Path::new(&root).join(format!("{name}-stage")); fs::create_dir_all(output.join("media")).unwrap();
                fs::copy(dir.path().join("raw.json"),output.join("raw.json")).unwrap();
                for entry in fs::read_dir(dir.path().join("media")).unwrap() { let entry=entry.unwrap();fs::copy(entry.path(),output.join("media").join(entry.file_name())).unwrap(); }
            }
        }
    }
    #[test] fn protobuf_bounds() { assert!(proto(&[10,255]).is_err()); assert_eq!(string_field(&[10,3,b'a',b'b',b'c'],1).unwrap(),"abc"); assert_eq!(integer_field(&[8,3],1).unwrap(),3); }
}
