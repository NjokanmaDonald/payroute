import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import TransactionList from './pages/TransactionList';
import PaymentForm from './pages/PaymentForm';
import TransactionDetail from './pages/TransactionDetail';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-100 font-sans">
        <nav className="bg-blue-800 h-14 flex items-center shadow-md">
          <div className="flex items-center gap-8 max-w-5xl mx-auto px-6 w-full">
            <div className="font-extrabold text-lg text-white tracking-wide">
              PayRoute
            </div>
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `text-sm pb-0.5 border-b-2 no-underline ${isActive ? 'text-white font-bold border-white' : 'text-white/70 font-medium border-transparent'}`
              }
            >
              Transactions
            </NavLink>
            <NavLink
              to="/payments/new"
              className={({ isActive }) =>
                `text-sm pb-0.5 border-b-2 no-underline ${isActive ? 'text-white font-bold border-white' : 'text-white/70 font-medium border-transparent'}`
              }
            >
              New Payment
            </NavLink>
          </div>
        </nav>

        <main className="max-w-5xl mx-auto px-6 py-8">
          <Routes>
            <Route path="/" element={<TransactionList />} />
            <Route path="/payments/new" element={<PaymentForm />} />
            <Route path="/payments/:id" element={<TransactionDetail />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
