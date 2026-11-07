import SwiftUI
import WebKit

struct ContentView: View {
    @State private var serverUrl: String = UserDefaults.standard.string(forKey: "senro:serverUrl") ?? ""
    @State private var showingSetup: Bool = false
    @State private var reloadTick = 0

    var body: some View {
        ZStack {
            if serverUrl.isEmpty {
                SetupView(serverUrl: $serverUrl, onSave: {
                    UserDefaults.standard.set(serverUrl, forKey: "senro:serverUrl")
                    reloadTick += 1
                })
            } else {
                VStack(spacing: 0) {
                    WebView(urlString: serverUrl)
                        .id(reloadTick)
                    HStack {
                        Text(serverUrl)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Spacer()
                        Button("Değiştir") { showingSetup = true }
                            .font(.caption2)
                    }
                    .padding([.horizontal, .bottom], 6)
                    .background(.ultraThinMaterial)
                }
            }
        }
        .sheet(isPresented: $showingSetup) {
            NavigationView {
                SetupView(serverUrl: $serverUrl, onSave: {
                    UserDefaults.standard.set(serverUrl, forKey: "senro:serverUrl")
                    reloadTick += 1
                    showingSetup = false
                })
                .navigationTitle("Sunucu adresi")
            }
        }
    }
}

struct SetupView: View {
    @Binding var serverUrl: String
    var onSave: () -> Void
    @State private var error: String?

    var body: some View {
        VStack(spacing: 16) {
            Text("SenroMusic sunucunuzun adresini girin")
                .font(.headline)
                .multilineTextAlignment(.center)
            TextField("https://muzik.ornek.com", text: $serverUrl)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.URL)
                .autocapitalization(.none)
                .disableAutocorrection(true)
                .padding(.horizontal)
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
            }
            Button("Bağlan") {
                let trimmed = serverUrl.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let url = URL(string: trimmed), let scheme = url.scheme, scheme == "http" || scheme == "https" else {
                    error = "Geçerli bir http:// veya https:// adresi girin."
                    return
                }
                serverUrl = trimmed
                onSave()
            }
            .buttonStyle(.borderedProminent)
            .disabled(serverUrl.isEmpty)
            Text("iOS'ta HTTPS adresi kullanın (örn. https://muzik.ornek.com).\nAynı adres web sürümündeki Ayarlar ile aynıdır.")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .padding()
    }
}

struct WebView: UIViewRepresentable {
    let urlString: String
    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        return webView
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {
        guard let url = URL(string: urlString) else { return }
        if uiView.url?.absoluteString != url.absoluteString {
            uiView.load(URLRequest(url: url))
        }
    }
}
