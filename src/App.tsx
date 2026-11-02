// What a Tatum app looks like in token roles: no hex, no arbitrary [] values, no numeric
// scales for spacing, radius, type or elevation. Structural utilities are not token roles and
// stay as they are. Keep it that way — this is the one styled file in the scaffold, so it is
// what the agent has in front of it whenever it does read the project before writing UI.
//
// Deliberately empty: this is what the preview frames until the first build writes this
// file, and anything drawn here reads to the user as part of their app.
export default function App() {
  return <div className="min-h-screen bg-primary" />
}
