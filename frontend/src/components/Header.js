import React from 'react';

const Header = () => {
  return (
    <header className="forum-header">
      <h1>My Awesome Forum</h1>
      <nav>
        <ul className="nav-list">
          <li><a href="/">Home</a></li>
          <li><a href="/categories">Categories</a></li>
          <li><a href="/new-post">New Post</a></li>
        </ul>
      </nav>
    </header>
  );
};

export default Header;
