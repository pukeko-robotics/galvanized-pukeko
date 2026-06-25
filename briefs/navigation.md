In the main UI application packages/galvanized-pukeko-web-client/src/App.vue create four new regions:

- Header, id=galvanized-pukeko-ui-nav-header
- Left Sidebar, id=galvanized-pukeko-ui-nav-right-sidebar
- Right Sidebar, id=galvanized-pukeko-ui-nav-left-sidebar
- Footer, id=galvanized-pukeko-ui-nav-footer

Sidebars and the footer should by default be empty with the main content outweighing them, unless something is added.

The header should include packages/galvanized-pukeko-web-client/src/components/PkNavHeader.vue

Once the new layout is established refactor the PkNavHeader.vue
- Extract the logo into a separate component
- PkNavHeader component to use slots, all elements should be placed in the slots.
- Refactor the KitchenSink to add some components to the slots (may reuse those hardcoded in the PkNavHeader.vue now)
- In App.vue add the logo in appropriate slot of PkNavHeader.vue
- Add a link "About Galvanized Pukeko" pointing to https://github.com/pukeko-robotics/galvanized-pukeko/
- Make sure standard playwright tests (according to root README.md) they are a bit flakey, try more than once if only one or two fail.
