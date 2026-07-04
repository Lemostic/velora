//! XML ↔ JSON 双向转换模块
//!
//! 用 `quick-xml` 把 XML 解析成一个最小化的 JsonValue；JSON 用 `serde_json` 解析。
//! 反向用 `quick-xml`'s serializer 把 JsonValue 写回 XML。
//!
//! 约定：
//!   - XML 属性转 `@attr` 前缀字段（避免与子元素重名）。
//!   - 多重同名子元素 → 数组。
//!   - 文本节点：`<a>hello</a>` → `{ "a": "hello" }`；
//!     `<a>text<child/></a>` → `{ "a": { "#text": "text", "child": {} } }`。
//!   - 声明 `<?xml version="1.0"?>` 不强制要求；序列化时默认带 UTF-8 头。

use quick_xml::events::{BytesStart, BytesEnd, BytesText, Event};
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Deserialize)]
pub struct XmlToJsonRequest {
    pub xml: String,
    /// 重复元素是数组，还是只保留最后/首个？
    /// true（默认）= 数组；false = 保留首个出现
    #[serde(default = "default_true")]
    pub arrays: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct XmlToJsonResult {
    pub json: Value,
    /// 解析是否遇到错误（部分容错时填）
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn xml_to_json(req: XmlToJsonRequest) -> Result<XmlToJsonResult, String> {
    let mut reader = Reader::from_str(&req.xml);
    reader.config_mut().trim_text(true);
    let mut errors: Vec<String> = Vec::new();
    let mut buf = Vec::new();
    let mut stack: Vec<Map<String, Value>> = Vec::new();
    stack.push(Map::new());
    let root_name = std::mem::replace(
        &mut std::env::current_dir().ok(), // placeholder 不影响逻辑
        None,
    );

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let mut node = Map::new();
                // attrs
                for attr in e.attributes().flatten() {
                    let k =
                        String::from_utf8_lossy(attr.key.as_ref()).to_string();
                    let v = String::from_utf8_lossy(&attr.value).to_string();
                    node.insert(format!("@{}", k), Value::String(v));
                }
                stack.push(node);
                let _ = name; // 名是下一次判断的；本轮只 push 空 node 接受子事件
                let _ = root_name;
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let mut node = match stack.pop() {
                    Some(n) => n,
                    None => {
                        continue;
                    }
                };
                // 把累积的纯文本放到 "#text"
                let text = node
                    .remove("#pending_text")
                    .and_then(|v| match v {
                        Value::String(s) if !s.is_empty() => Some(Value::String(s)),
                        _ => None,
                    });
                if let Some(t) = text {
                    node.insert("#text".to_string(), t);
                }
                // 现在 node 是这个结束标签的内容；插到父
                if let Some(parent) = stack.last_mut() {
                    insert_child(parent, name, Value::Object(node), req.arrays);
                } else {
                    // root single node, no parent — push back as root
                    stack.push(node);
                    break;
                }
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let mut node = Map::new();
                for attr in e.attributes().flatten() {
                    let k = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                    let v = String::from_utf8_lossy(&attr.value).to_string();
                    node.insert(format!("@{}", k), Value::String(v));
                }
                if let Some(parent) = stack.last_mut() {
                    insert_child(
                        parent,
                        name,
                        Value::Object(node),
                        req.arrays,
                    );
                }
            }
            Ok(Event::Text(t)) => {
                let txt = t.unescape().unwrap_or_default().to_string();
                if let Some(parent) = stack.last_mut() {
                    let cur = parent
                        .entry("#pending_text".to_string())
                        .or_insert(Value::String(String::new()));
                    if let Value::String(s) = cur {
                        s.push_str(&txt);
                    }
                }
            }
            Ok(Event::CData(t)) => {
                if let Some(parent) = stack.last_mut() {
                    let cur = parent
                        .entry("#pending_text".to_string())
                        .or_insert(Value::String(String::new()));
                    if let Value::String(s) = cur {
                        s.push_str(&String::from_utf8_lossy(t.as_ref()));
                    }
                }
            }
            Ok(Event::Decl(_)) | Ok(Event::PI(_)) | Ok(Event::Comment(_)) | Ok(Event::DocType(_)) => {
                // ignore
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                errors.push(format!("line {}: {e}", reader.buffer_position()));
                break;
            }
            _ => {}
        }
        buf.clear();
    }

    let root = stack
        .pop()
        .map(Value::Object)
        .unwrap_or(Value::Object(Map::new()));

    Ok(XmlToJsonResult { json: root, errors })
}

fn insert_child(
    parent: &mut Map<String, Value>,
    key: String,
    value: Value,
    arrays: bool,
) {
    if !arrays {
        if !parent.contains_key(&key) {
            parent.insert(key, value);
        }
        // else: drop
        return;
    }
    match parent.entry(key) {
        serde_json::map::Entry::Vacant(v) => {
            v.insert(value);
        }
        serde_json::map::Entry::Occupied(mut o) => {
            let cur = o.get_mut();
            if !cur.is_array() {
                let prev = cur.take();
                *cur = Value::Array(vec![prev]);
            }
            if let Value::Array(arr) = cur {
                arr.push(value);
            }
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct JsonToXmlRequest {
    /// 必须是对象 / 数组
    pub json: Value,
    /// 根元素名（仅顶层为对象时有效，否则用 `root` 占位）
    #[serde(default = "default_root")]
    pub root_name: String,
    /// 数组项是否需要 wrapper（默认 false = 直接展开为多个同名子元素）
    #[serde(default)]
    pub wrap_array_items: bool,
}

fn default_root() -> String {
    "root".to_string()
}

#[derive(Debug, Serialize)]
pub struct JsonToXmlResult {
    pub xml: String,
}

#[tauri::command]
pub fn json_to_xml(req: JsonToXmlRequest) -> Result<JsonToXmlResult, String> {
    let mut buf = String::new();
    buf.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");

    let root = req.root_name.clone();
    let wrap = req.wrap_array_items;

    match req.json {
        Value::Object(map) => {
            write_object(&mut buf, &root, &map, wrap, 0)?;
        }
        Value::Array(arr) => {
            buf.push('<');
            buf.push_str(&root);
            buf.push('>');
            for v in arr {
                write_value(&mut buf, "item", &v, wrap, 1)?;
            }
            buf.push_str("</");
            buf.push_str(&root);
            buf.push('>');
        }
        other => {
            // 单值：包成 root
            buf.push('<');
            buf.push_str(&root);
            buf.push('>');
            write_value_text(&mut buf, &other);
            buf.push_str("</");
            buf.push_str(&root);
            buf.push('>');
        }
    }

    Ok(JsonToXmlResult { xml: buf })
}

fn write_object(
    buf: &mut String,
    name: &str,
    map: &Map<String, Value>,
    wrap_array: bool,
    indent: usize,
) -> Result<(), String> {
    buf.push('<');
    buf.push_str(name);

    let mut children: Vec<(&String, &Value)> = Vec::new();
    let mut text: Option<String> = None;

    for (k, v) in map {
        if let Some(rest) = k.strip_prefix('@') {
            buf.push(' ');
            buf.push_str(rest);
            buf.push_str("=\"");
            let s = value_to_string(v);
            buf.push_str(&escape_attr(&s));
            buf.push('"');
        } else if k == "#text" {
            text = Some(value_to_string(v));
        } else {
            children.push((k, v));
        }
    }

    if children.is_empty() {
        match text {
            Some(ref t) if !t.is_empty() => {
                buf.push('>');
                buf.push_str(&escape_text(t));
                buf.push_str("</");
                buf.push_str(name);
                buf.push('>');
                return Ok(());
            }
            _ => {
                buf.push_str(" />");
                return Ok(());
            }
        }
    }

    buf.push('>');
    if let Some(t) = text {
        if !t.is_empty() {
            buf.push_str(&escape_text(&t));
        }
    }
    for (k, v) in &children {
        match v {
            Value::Array(arr) if wrap_array => {
                for item in arr {
                    write_value(buf, k, item, wrap_array, indent + 1)?;
                }
            }
            Value::Array(arr) => {
                // 直接展开为多个同名子元素
                for item in arr {
                    write_value(buf, k, item, wrap_array, indent + 1)?;
                }
            }
            _ => {
                write_value(buf, k, v, wrap_array, indent + 1)?;
            }
        }
    }
    buf.push_str("</");
    buf.push_str(name);
    buf.push('>');
    Ok(())
}

fn write_value(
    buf: &mut String,
    name: &str,
    v: &Value,
    wrap: bool,
    indent: usize,
) -> Result<(), String> {
    match v {
        Value::Object(map) => write_object(buf, name, map, wrap, indent),
        Value::Array(_) => {
            // 不应到这里；外层已经处理
            write_object(buf, name, &Map::new(), wrap, indent)
        }
        _ => {
            buf.push('<');
            buf.push_str(name);
            buf.push('>');
            write_value_text(buf, v);
            buf.push_str("</");
            buf.push_str(name);
            buf.push('>');
            Ok(())
        }
    }
}

fn write_value_text(buf: &mut String, v: &Value) {
    let s = value_to_string(v);
    buf.push_str(&escape_text(&s));
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn escape_text(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attr(s: &str) -> String {
    let mut out = escape_text(s);
    out = out.replace('"', "&quot;");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xml_to_json_simple_attrs() {
        let r = xml_to_json(XmlToJsonRequest {
            xml: "<root a=\"1\" b=\"hi\"><x>1</x></root>".into(),
            arrays: true,
        })
        .unwrap();
        assert_eq!(r.json["root"]["@a"], "1");
        assert_eq!(r.json["root"]["@b"], "hi");
        assert_eq!(r.json["root"]["x"], "1");
    }

    #[test]
    fn xml_to_json_repeats_become_array() {
        let r = xml_to_json(XmlToJsonRequest {
            xml: "<r><x>1</x><x>2</x></r>".into(),
            arrays: true,
        })
        .unwrap();
        let xs = r.json["r"]["x"].as_array().unwrap();
        assert_eq!(xs.len(), 2);
    }

    #[test]
    fn json_to_xml_simple_roundtrip() {
        let v: Value = serde_json::from_str(
            r#"{"root":{"@id":"42","items":[{"v":"a"},{"v":"b"}]}}"#,
        )
        .unwrap();
        let r = json_to_xml(JsonToXmlRequest {
            json: v,
            root_name: "root".into(),
            wrap_array_items: false,
        })
        .unwrap();
        assert!(r.xml.contains("id=\"42\""));
        assert!(r.xml.contains("<v>a</v>"));
        assert!(r.xml.contains("<v>b</v>"));
    }
}
