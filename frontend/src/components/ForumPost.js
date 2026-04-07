import React from 'react';

const ForumPost = ({ post }) => {
  return (
    <div className="forum-post">
      <h2>{post.title}</h2>
      <p className="post-meta">By {post.author} on {post.date}</p>
      <div className="post-content">
        <p>{post.content}</p>
      </div>
    </div>
  );
};

export default ForumPost;
