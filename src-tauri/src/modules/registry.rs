//! 静态内置模块注册中心
//!
//! 设计原则：
//! 1. **静态优先**：MVP 阶段把 11 个模块的元数据全部手写在这里，零运行时扫描开销
//! 2. **可演进**：未来 `plugins_dir` 扫描动态插件时，只要让 `ModuleRegistry::builtin()` 合并静态 + 动态即可
//! 3. **前后端共用语义**：id / category 字符串必须与前端 `src/lib/registry.ts` 保持一致

#[derive(Debug, Clone, Copy)]
pub struct ModuleMeta {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub description: &'static str,
}

pub struct ModuleRegistry;

impl ModuleRegistry {
    pub fn builtin() -> BuiltinModules {
        BuiltinModules
    }
}

pub struct BuiltinModules;

impl BuiltinModules {
    /// 返回按 category 分组、组内按 id 排序的内置模块列表
    pub fn list(&self) -> Vec<ModuleMeta> {
        let mut all = vec![
            // ===== 简单工具（首批迁） =====
            ModuleMeta {
                id: "qrcode",
                name: "二维码",
                category: "tools",
                description: "文本 / URL / WiFi 一键生成二维码",
            },
            ModuleMeta {
                id: "excel-to-json",
                name: "Excel → JSON",
                category: "tools",
                description: "把 Excel 表格转成结构化 JSON，支持多 sheet 批量",
            },
            ModuleMeta {
                id: "excel-transpose",
                name: "Excel 转置",
                category: "tools",
                description: "行列互换 + 字段映射",
            },
            // ===== 文件 / 转换 =====
            ModuleMeta {
                id: "file-treeview",
                name: "文件树",
                category: "files",
                description: "浏览本地目录结构，支持搜索和大文件过滤",
            },
            ModuleMeta {
                id: "zip-clean",
                name: "Zip 清理",
                category: "files",
                description: "扫描并清理重复/空 zip 压缩包",
            },
            ModuleMeta {
                id: "xml-json",
                name: "XML ↔ JSON",
                category: "convert",
                description: "XML 与 JSON 双向互转",
            },
            ModuleMeta {
                id: "markitdown",
                name: "Markitdown",
                category: "convert",
                description: "把 PDF / Word / Excel 转成 Markdown",
            },
            // ===== DevTools / 搜索 =====
            ModuleMeta {
                id: "process-manager",
                name: "进程管理",
                category: "devtools",
                description: "查看本机进程、CPU/内存占用、结束进程",
            },
            ModuleMeta {
                id: "es-query",
                name: "ES 查询",
                category: "search",
                description: "Elasticsearch 可视化查询",
            },
            // ===== 主力模块（第三阶段迁） =====
            ModuleMeta {
                id: "excel-schedule",
                name: "研发计划排期",
                category: "productivity",
                description: "Excel 排期 + 甘特图 + 多维度过滤 + Owner 统计",
            },
            // ===== 系统 =====
            ModuleMeta {
                id: "preferences",
                name: "偏好设置",
                category: "system",
                description: "主题、快捷键、插件管理",
            },
        ];
        all.sort_by(|a, b| a.category.cmp(&b.category).then(a.id.cmp(&b.id)));
        all
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_is_sorted_and_non_empty() {
        let list = ModuleRegistry::builtin().list();
        assert!(!list.is_empty());
        for pair in list.windows(2) {
            assert!(
                pair[0].category <= pair[1].category,
                "modules must be sorted by category then id"
            );
        }
    }

    #[test]
    fn ids_are_unique() {
        let list = ModuleRegistry::builtin().list();
        let mut ids: Vec<_> = list.iter().map(|m| m.id).collect();
        ids.sort();
        let len = ids.len();
        ids.dedup();
        assert_eq!(len, ids.len(), "duplicate module id detected");
    }
}
