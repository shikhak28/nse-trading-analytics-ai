import { NavLink } from 'react-router-dom';

function Sidebar() {
  return (
    <div className="sidebar">
      <div className="logo">TradeX</div>
      <div className="nav-links">
        {[
          { to: '/', label: 'Dashboard' },
          { to: '/market', label: 'Market' },
          { to: '/trading', label: 'Trading' },
          { to: '/agent', label: 'AI Agent' },
          { to: '/history', label: 'History' },
          { to: '/predictions', label: 'Predictions' },
          { to: '/verification', label: 'Verification' },
          { to: '/accuracy', label: 'Accuracy' },
          { to: '/model-health', label: 'Model Health' },
        ].map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `nav-item${isActive ? ' active' : ''}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export default Sidebar;
