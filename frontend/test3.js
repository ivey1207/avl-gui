import * as THREE from 'three';
const group = new THREE.Group();
const grid = new THREE.GridHelper(20, 20);
group.add(grid);
const bounds = new THREE.Box3().setFromObject(group);
const size = new THREE.Vector3();
bounds.getSize(size);
console.log(size);
