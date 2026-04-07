import React from 'react';
import ForumPost from './ForumPost';

const mockPosts = [
  {
    id: 1,
    title: 'Welcome to the Forum!',
    author: 'Admin',
    date: '2023-10-26',
    content: 'This is the first post on our new forum. Feel free to introduce yourselves!',
  },
  {
    id: 2,
    title: 'React Hooks Best Practices',
    author: 'DevMaster',
    date: '2023-10-25',
    content: 'Sharing some insights on how to effectively use React Hooks.',
  },
  {
    id: 3,
    title: 'CSS Grid vs Flexbox',
    author: 'StyleGuru',
    date: '2023-10-24',
    content: 'A discussion on when to use CSS Grid versus Flexbox for layout.',
  },
];

const ForumList = () => {
  return (
    <div className="forum-post-list">
      {mockPosts.map(post => (
        <ForumPost key={post.id} post={post} />
      ))}
    </div>
  );
};

export default ForumList;
