/**
 * @license Copyright (c) 2003-2018, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

import ModelTestEditor from '@ckeditor/ckeditor5-core/tests/_utils/modeltesteditor';
import Batch from '@ckeditor/ckeditor5-engine/src/model/batch';
import UndoEngine from '../src/undoengine';

describe( 'UndoEngine', () => {
	let editor, undo, model, root;

	beforeEach( () => {
		editor = new ModelTestEditor();

		model = editor.model;
		root = model.document.getRoot();

		undo = new UndoEngine( editor );
		undo.init();
	} );

	afterEach( () => {
		undo.destroy();
	} );

	describe( 'UndoEngine', () => {
		it( 'should register undo command and redo command', () => {
			expect( editor.commands.get( 'undo' ) ).to.equal( undo._undoCommand );
			expect( editor.commands.get( 'redo' ) ).to.equal( undo._redoCommand );
		} );

		it( 'should add a batch to undo command and clear redo stack, if it\'s type is "default"', () => {
			sinon.spy( undo._undoCommand, 'addBatch' );
			sinon.spy( undo._redoCommand, 'clearStack' );

			expect( undo._undoCommand.addBatch.called ).to.be.false;
			expect( undo._redoCommand.clearStack.called ).to.be.false;

			model.change( writer => {
				writer.insertText( 'foobar', root );
			} );

			expect( undo._undoCommand.addBatch.calledOnce ).to.be.true;
			expect( undo._redoCommand.clearStack.calledOnce ).to.be.true;
		} );

		it( 'should add each batch only once', () => {
			sinon.spy( undo._undoCommand, 'addBatch' );

			model.change( writer => {
				writer.insertText( 'foobar', root );
				writer.insertText( 'foobar', root );
			} );

			expect( undo._undoCommand.addBatch.calledOnce ).to.be.true;
		} );

		it( 'should not add a batch that has only non-document operations', () => {
			sinon.spy( undo._undoCommand, 'addBatch' );

			model.change( writer => {
				const docFrag = writer.createDocumentFragment();
				const element = writer.createElement( 'paragraph' );
				writer.insert( element, docFrag, 0 );
				writer.insertText( 'foo', null, element, 0 );
			} );

			expect( undo._undoCommand.addBatch.called ).to.be.false;
		} );

		it( 'should add a batch that has both document and non-document operations', () => {
			sinon.spy( undo._undoCommand, 'addBatch' );

			model.change( writer => {
				const element = writer.createElement( 'paragraph' );
				writer.insertText( 'foo', null, element, 0 );
				writer.insert( element, root, 0 );
			} );

			expect( undo._undoCommand.addBatch.calledOnce ).to.be.true;
		} );

		it( 'should add a batch to undo command, if it\'s type is undo and it comes from redo command', () => {
			sinon.spy( undo._undoCommand, 'addBatch' );
			sinon.spy( undo._redoCommand, 'clearStack' );

			const batch = new Batch();

			undo._redoCommand._createdBatches.add( batch );

			model.enqueueChange( batch, writer => {
				writer.insertText( 'foobar', root );
			} );

			expect( undo._undoCommand.addBatch.calledOnce ).to.be.true;
			expect( undo._redoCommand.clearStack.called ).to.be.false;
		} );

		it( 'should add a batch to redo command on undo revert event', () => {
			sinon.spy( undo._redoCommand, 'addBatch' );
			sinon.spy( undo._redoCommand, 'clearStack' );

			undo._undoCommand.fire( 'revert', null, new Batch() );

			expect( undo._redoCommand.addBatch.calledOnce ).to.be.true;
			expect( undo._redoCommand.clearStack.called ).to.be.false;
		} );
	} );
} );
