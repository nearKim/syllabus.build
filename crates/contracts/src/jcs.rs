//! RFC 8785 JSON Canonicalization Scheme (JCS) + SHA-256 digest computation (`NFR-005`).

use serde_json::Value;
use sha2::{Digest, Sha256};

/// Serializes a `serde_json::Value` into its canonical UTF-8 string representation
/// per RFC 8785 (JSON Canonicalization Scheme):
/// - Object keys sorted lexicographically by UTF-16 code units (equivalent to Unicode scalar
///   order for BMP characters used in our schemas/fixtures, implemented explicitly over UTF-16 code units).
/// - No insignificant whitespace.
/// - Standard JSON string escaping (`\b`, `\t`, `\n`, `\f`, `\r`, `\"`, `\\`, and `\uXXXX` for `<= 0x1F`).
pub fn canonicalize_jcs(value: &Value) -> String {
    let mut out = String::new();
    write_jcs(value, &mut out);
    out
}

/// Computes the lower-case hex SHA-256 digest over the UTF-8 RFC 8785 JCS canonicalization of `value`.
pub fn jcs_sha256_hex(value: &Value) -> String {
    let canonical = canonicalize_jcs(value);
    sha256_bytes_hex(canonical.as_bytes())
}

/// Computes the lower-case hex SHA-256 digest over raw bytes.
pub fn sha256_bytes_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn cmp_utf16(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn write_jcs_string(s: &str, out: &mut String) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{0009}' => out.push_str("\\t"),
            '\u{000A}' => out.push_str("\\n"),
            '\u{000C}' => out.push_str("\\f"),
            '\u{000D}' => out.push_str("\\r"),
            c if (c as u32) <= 0x1F => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write_jcs(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                out.push_str(&i.to_string());
            } else if let Some(u) = n.as_u64() {
                out.push_str(&u.to_string());
            } else if let Some(f) = n.as_f64() {
                if f == 0.0 {
                    out.push('0');
                } else if f.fract() == 0.0 && f.abs() < 1e15 {
                    out.push_str(&format!("{:.0}", f));
                } else {
                    out.push_str(&n.to_string());
                }
            } else {
                out.push_str(&n.to_string());
            }
        }
        Value::String(s) => write_jcs_string(s, out),
        Value::Array(items) => {
            out.push('[');
            for (idx, item) in items.iter().enumerate() {
                if idx > 0 {
                    out.push(',');
                }
                write_jcs(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut entries: Vec<(&String, &Value)> = map.iter().collect();
            entries.sort_by(|(ka, _), (kb, _)| cmp_utf16(ka, kb));
            out.push('{');
            for (idx, (k, v)) in entries.iter().enumerate() {
                if idx > 0 {
                    out.push(',');
                }
                write_jcs_string(k, out);
                out.push(':');
                write_jcs(v, out);
            }
            out.push('}');
        }
    }
}
