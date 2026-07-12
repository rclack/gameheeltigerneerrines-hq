import Button from "@/components/ui/Button";

export default function CommissionerDashboard() {
  return (
    
    <main className="min-h-screen bg-slate-100">
      {/* Header */}
      <header className="bg-blue-950 text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-8 py-5">
          <h1 className="text-3xl font-bold">
            🏈 Commissioner Portal
          </h1>

          <div className="text-right">
            <p className="font-semibold">GameHeelTigerNeerRines HQ</p>
            <p className="text-sm text-slate-300">2026 Season</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-8">

        {/* League Overview */}
        <div className="mb-8 rounded-xl bg-white p-6 shadow">
          <h2 className="mb-4 text-2xl font-bold">
            League Overview
          </h2>

          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">

            <div className="rounded-lg bg-slate-100 p-4">
              <p className="text-sm text-slate-500">League</p>
              <p className="text-xl font-bold">Test League</p>
            </div>

            <div className="rounded-lg bg-slate-100 p-4">
              <p className="text-sm text-slate-500">Status</p>
              <p className="text-xl font-bold">Preseason</p>
            </div>

            <div className="rounded-lg bg-slate-100 p-4">
              <p className="text-sm text-slate-500">Owners</p>
              <p className="text-xl font-bold">0 / 12</p>
            </div>

            <div className="rounded-lg bg-slate-100 p-4">
              <p className="text-sm text-slate-500">Teams Drafted</p>
              <p className="text-xl font-bold">0 / 72</p>
            </div>

          </div>
        </div>

        {/* Navigation Cards */}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">

          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="mb-3 text-xl font-bold">🏆 League Management</h3>

            <Button variant="primary" className="mb-2">
              Create League
            </Button>

            <Button variant="secondary">
              League Settings
            </Button>
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="mb-3 text-xl font-bold">👥 Owners</h3>

            <Button variant="success">
              Manage Owners
            </Button>
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="mb-3 text-xl font-bold">🎯 Draft</h3>

            <Button variant="sports">
              Draft Room
            </Button>
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="mb-3 text-xl font-bold">📊 Results</h3>

            <Button variant="info">
              Standings
            </Button>
          </div>

          <div className="rounded-xl bg-white p-6 shadow">
            <h3 className="mb-3 text-xl font-bold">⚙ Administration</h3>

            <Button variant="danger">
              Scoring Rules
            </Button>
          </div>

        </div>

      </div>
    </main>
  );
}