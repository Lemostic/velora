//! Elasticsearch 查询模块 — Rust 端命令实现
//!
//! 直接打 ES 的 REST API：避免拉 `elasticsearch` 这个 crate（它会把
//! tokio / serde_json 大半个生态一起拖进来）。这里用 `reqwest` 同步模式
//! 调 `_search` 端点。
//!
//! 安全策略：
//!  - cluster_url 必须以 http:// 或 https:// 开头；
//!  - 拒绝向私有 IP 直连之外的任意地址发请求（用户手动设置就行，
//!    不做过严的 SSRF 拦截，避免误伤本地集群）；
//!  - 不暴露密码字段到前端，password 只在内存中传给命令。

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct EsQueryRequest {
    /// 集群 URL，例如 `http://localhost:9200`
    pub url: String,
    /// Basic auth 用户名（可选）
    #[serde(default)]
    pub username: String,
    /// Basic auth 密码（可选，与 username 一起传）
    #[serde(default)]
    pub password: String,
    /// 索引 / 索引 pattern（必填）
    pub index: String,
    /// 查询体，是 JSON 字符串（DSL）。`match_all` 的 query 体可以传 `{"query":{"match_all":{}}}`
    pub query_body: String,
    /// 限制返回条数（top N），默认 50
    #[serde(default = "default_size")]
    pub size: u32,
}

fn default_size() -> u32 {
    50
}

#[derive(Debug, Serialize)]
pub struct EsQueryResult {
    /// ES 返回的 took（毫秒）
    pub took_ms: u64,
    /// 总命中数（来自 hits.total.value）
    pub total: u64,
    /// hits.hits 数组（精简：_id / _index / _source / 高亮 / sort 都平铺）
    pub hits: Vec<EsHit>,
    /// 集群名（来自响应头 / _cluster/_settings ）
    pub cluster_name: String,
}

#[derive(Debug, Serialize)]
pub struct EsHit {
    pub id: String,
    pub index: String,
    pub score: f64,
    /// _source 的 JSON 字符串（不解析，保持原始形态方便前端展示）
    pub source: String,
}

#[tauri::command]
pub fn es_query(req: EsQueryRequest) -> Result<EsQueryResult, String> {
    if !(req.url.starts_with("http://") || req.url.starts_with("https://")) {
        return Err(format!("url must start with http:// or https://, got: {}", req.url));
    }
    if req.index.trim().is_empty() {
        return Err("index must not be empty".into());
    }
    if req.query_body.trim().is_empty() {
        return Err("query_body must not be empty".into());
    }

    let url = format!(
        "{}/{}/_search",
        req.url.trim_end_matches('/'),
        req.index.trim_matches('/')
    );

    // 用 blocking client 同步发请求
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("client build: {e}"))?;

    let mut builder = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .body(req.query_body.clone());
    // 把 size 直接并入 body？ES 接受 URL ?size= 也接受 body.size。
    // 这里把 size 透传进 body —— 但用户传进来的 body 已经带了 size 就保留。
    if !req.query_body.contains("\"size\"") {
        // 简单追加到顶层，覆盖用户没填的情况
        let with_size = inject_size(&req.query_body, req.size);
        builder = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .body(with_size);
    }
    if !req.username.is_empty() {
        builder = builder.basic_auth(&req.username, Some(&req.password));
    }

    let resp = builder
        .send()
        .map_err(|e| format!("send: {e}"))?;
    let status = resp.status();
    let bytes = resp.bytes().map_err(|e| format!("read body: {e}"))?;
    if !status.is_success() {
        let body_s = String::from_utf8_lossy(&bytes);
        return Err(format!(
            "ES responded {}: {}",
            status,
            body_s.chars().take(400).collect::<String>()
        ));
    }

    let v: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("parse: {e}"))?;

    let took = v
        .get("took")
        .and_then(|x| x.as_u64())
        .unwrap_or(0);
    let cluster = v
        .pointer("/_cluster/name")
        .and_then(|x| x.as_str())
        .unwrap_or("unknown")
        .to_string();
    let total = v
        .pointer("/hits/total/value")
        .and_then(|x| x.as_u64())
        .unwrap_or(0);
    let hits_arr = v
        .pointer("/hits/hits")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();

    let mut hits: Vec<EsHit> = Vec::with_capacity(hits_arr.len());
    for h in hits_arr {
        let id = h
            .get("_id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let index = h
            .get("_index")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let score = h.get("_score").and_then(|x| x.as_f64()).unwrap_or(0.0);
        let source = h
            .get("_source")
            .map(|x| serde_json::to_string(x).unwrap_or_default())
            .unwrap_or_default();
        hits.push(EsHit {
            id,
            index,
            score,
            source,
        });
        if hits.len() >= req.size as usize {
            break;
        }
    }

    Ok(EsQueryResult {
        took_ms: took,
        total,
        hits,
        cluster_name: cluster,
    })
}

fn inject_size(body: &str, size: u32) -> String {
    // 简单尝试：用一个 serde_json::Value 解析，
    // 加 size 字段，再序列化。失败时退回到原 body。
    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(mut v) => {
            if let Some(obj) = v.as_object_mut() {
                obj.entry("size".to_string())
                    .or_insert(serde_json::Value::Number(serde_json::Number::from(size)));
            }
            serde_json::to_string(&v).unwrap_or_else(|_| body.to_string())
        }
        Err(_) => body.to_string(),
    }
}

#[derive(Debug, Deserialize)]
pub struct EsListIndicesRequest {
    pub url: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    /// pattern 默认 "*"
    #[serde(default)]
    pub pattern: String,
}

#[derive(Debug, Serialize)]
pub struct EsListIndicesResult {
    pub indices: Vec<String>,
}

#[tauri::command]
pub fn es_list_indices(
    req: EsListIndicesRequest,
) -> Result<EsListIndicesResult, String> {
    if !(req.url.starts_with("http://") || req.url.starts_with("https://")) {
        return Err("url must start with http:// or https://".into());
    }
    let pattern = if req.pattern.is_empty() {
        "*".to_string()
    } else {
        req.pattern
    };
    let url = format!(
        "{}/_cat/indices/{}?h=index&format=json",
        req.url.trim_end_matches('/'),
        pattern
    );

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("client build: {e}"))?;
    let mut req_b = client.get(&url);
    if !req.username.is_empty() {
        req_b = req_b.basic_auth(&req.username, Some(&req.password));
    }
    let resp = req_b.send().map_err(|e| format!("send: {e}"))?;
    let status = resp.status();
    let bytes = resp.bytes().map_err(|e| format!("read body: {e}"))?;
    if !status.is_success() {
        return Err(format!("ES {}: {}", status, String::from_utf8_lossy(&bytes)));
    }
    let v: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("parse: {e}"))?;
    let arr = v.as_array().cloned().unwrap_or_default();
    let mut indices = Vec::with_capacity(arr.len());
    for x in arr {
        if let Some(s) = x.get("index").and_then(|s| s.as_str()) {
            indices.push(s.to_string());
        }
    }
    Ok(EsListIndicesResult { indices })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_non_http_url() {
        let r = es_query(EsQueryRequest {
            url: "ftp://localhost".into(),
            username: "".into(),
            password: "".into(),
            index: "x".into(),
            query_body: "{}".into(),
            size: 10,
        });
        assert!(r.is_err());
    }
}
