// Apply the saved font scale before first paint (messaging-specific key).
// H-5: externalized from auth.html inline <script> so script-src can drop
// 'unsafe-inline'. Loaded WITHOUT defer so it runs before paint.
(function() {
    var m = { 'very-small': 13, small: 14, medium: 16, large: 18, 'very-large': 20 };
    var s = localStorage.getItem('secure_messenger_fontScale') || 'medium';
    document.documentElement.style.fontSize = (m[s] || 16) + 'px';
})();
