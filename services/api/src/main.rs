use curriculum_api::build_router;
use curriculum_security::ReleaseFeatureGates;
use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    let addr: SocketAddr = std::env::var("API_BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_string())
        .parse()
        .expect("valid API_BIND_ADDR");
    let app = build_router(ReleaseFeatureGates::default());
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind listener");
    axum::serve(listener, app).await.expect("serve api");
}
