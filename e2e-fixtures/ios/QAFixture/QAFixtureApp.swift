import SwiftUI

@main
struct QAFixtureApp: App {
    var body: some Scene {
        WindowGroup {
            FixtureScreen()
        }
    }
}

struct FixtureScreen: View {
    @State private var email = ""
    @State private var submitted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Button(submitted ? "Welcome" : "Continue") {
                submitted = true
            }
            .accessibilityLabel(submitted ? "Welcome" : "Continue")
            .accessibilityIdentifier("continueButton")

            TextField("Email", text: $email)
                .accessibilityLabel("Email")
                .accessibilityIdentifier("emailField")
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)

            if submitted {
                Text("Welcome")
                    .font(.title)
                    .accessibilityLabel("Welcome message")
                    .accessibilityIdentifier("welcomeMessage")
            }
            Spacer()
        }
        .padding(24)
    }
}
