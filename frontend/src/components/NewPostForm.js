import React, { useState } from 'react';

const NewPostForm = () => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [author, setAuthor] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    // In a real application, you would send this data to a backend API.
    console.log('New Post:', { title, content, author });
    alert('Post submitted! (Check console for data)');
    setTitle('');
    setContent('');
    setAuthor('');
  };

  return (
    <div className="new-post-form-container">
      <h2>Create New Post</h2>
      <form onSubmit={handleSubmit} className="new-post-form">
        <div className="form-group">
          <label htmlFor="post-title">Title:</label>
          <input
            type="text"
            id="post-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="post-author">Author:</label>
          <input
            type="text"
            id="post-author"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="post-content">Content:</label>
          <textarea
            id="post-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
          ></textarea>
        </div>
        <button type="submit" className="submit-button">Submit Post</button>
      </form>
    </div>
  );
};

export default NewPostForm;
