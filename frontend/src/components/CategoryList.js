import React from 'react';

const mockCategories = [
  { id: 1, name: 'General Discussion' },
  { id: 2, name: 'Frontend Development' },
  { id: 3, name: 'Backend Development' },
  { id: 4, name: 'Project Showcase' },
];

const CategoryList = () => {
  return (
    <div className="category-list-container">
      <h2>Forum Categories</h2>
      <ul className="category-list">
        {mockCategories.map(category => (
          <li key={category.id}>
            <a href={`/category/${category.id}`}>{category.name}</a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CategoryList;
