import React from 'react';
import ForumPost from './ForumPost';

const ForumPostList = ({ posts }) => {
    return (
        <div className="forum-post-list">
            {posts.map(post => (
                <ForumPost key={post.id} post={post} />
            ))}
        </div>
    );
};

export default ForumPostList;
