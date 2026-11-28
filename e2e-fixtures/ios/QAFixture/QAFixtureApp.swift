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
            TextField("Email", text: $email)
                .accessibilityLabel("Email")
                .accessibilityIdentifier("emailField")
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)

            Button("Continue") {
                submitted = true
            }
            .accessibilityIdentifier("continueButton")

            if submitted {
                Text("Welcome")
                    .font(.title)
                    .accessibilityIdentifier("welcomeMessage")
            }
            Spacer()
        }
        .padding(24)
    }
}
