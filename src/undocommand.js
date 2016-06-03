/**
 * @license Copyright (c) 2003-2016, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

'use strict';

import Command from '../command/command.js';
import Batch from '../engine/model/batch.js';
import MoveDelta from '../engine/model/delta/movedelta.js';

/**
 * Undo command stores batches in itself and is able to and apply reverted versions of them on the document.
 *
 * @memberOf undo
 */
export default class UndoCommand extends Command {
	constructor( editor, type ) {
		super( editor );

		/**
		 * Items that are pairs of:
		 *
		 * * batches which are saved by the command and,
		 * * model selection state at the moment of saving the batch.
		 *
		 * @private
		 * @member {Array} undo.UndoCommand#_items
		 */
		this._items = [];

		/**
		 * Keeps track of which batch has been added to undo command.
		 *
		 * @private
		 * @member {WeakSet.<engine.model.Batch>} undo.UndoCommand#_batchRegistry
		 */
		this._batchRegistry = new WeakSet();

		this._type = type;

		this._originalDeltas = new WeakMap();
	}

	/**
	 * Stores a batch in the command. Stored batches can be then reverted.
	 *
	 * @param {engine.model.Batch} batch Batch to add.
	 */
	addBatch( batch ) {
		if ( !this._batchRegistry.has( batch ) ) {
			const selection = {
				ranges: Array.from( this.editor.document.selection.getRanges() ),
				isBackward: this.editor.document.selection.isBackward
			};

			this._items.push( { batch, selection } );
			this._batchRegistry.add( batch );

			this.refreshState();
		}
	}

	/**
	 * Removes all batches from the stack.
	 */
	clearStack() {
		this._items = [];
		this.refreshState();
	}

	/**
	 * @inheritDoc
	 */
	_checkEnabled() {
		return this._items.length > 0;
	}

	/**
	 * Executes the command: reverts a {@link engine.model.Batch batch} added to the command's stack,
	 * applies it on the document and removes the batch from the stack.
	 *
	 * @protected
	 * @fires undo.undoCommand#event:revert
	 * @param {engine.model.Batch} [batch] If set, batch that should be undone. If not set, the last added batch will be undone.
	 */
	_doExecute( batch = null ) {
		// If batch is not given, set `batchIndex` to the last index in command stack.
		let batchIndex = batch ? this._items.findIndex( ( a ) => a.batch == batch ) : this._items.length - 1;

		const originalDeltas = this._originalDeltas;

		// Get undo item and remove it from `_items`.
		const undoItem = this._items.splice( batchIndex, 1 )[ 0 ];

		// Remove batch from `_batchRegistry` to prevent mess and allow maybe adding this batch later.
		this._batchRegistry.delete( batch );

		// Get the batch to undo.
		const undoBatch = undoItem.batch;
		const undoDeltas = undoBatch.deltas.slice();
		// Deltas have to be applied in reverse order, so if batch did A B C, it has to do reversed C, reversed B, reversed A.
		undoDeltas.reverse();

		// Batch holding all changes done by deltas that reverts `undoBatch`.
		const reversionBatch = new Batch( undoBatch.doc );
		reversionBatch.type = this._type;

		this.editor.document.enqueueChanges( () => {
			// Reverse the deltas from the batch, transform them, apply them.
			for ( let undoDelta of undoDeltas ) {
				const undoDeltaReversed = undoDelta.getReversed();
				let updatedDeltas = this.editor.document.history.getTransformedDelta( undoDeltaReversed );

				for ( let delta of updatedDeltas ) {
					originalDeltas.set( delta, undoDelta );
				}

				postFix( updatedDeltas, this.editor.document.history.getDeltas( undoDelta.baseVersion ) );

				for ( let delta of updatedDeltas ) {
					reversionBatch.addDelta( delta );

					for ( let operation of delta.operations ) {
						this.editor.document.applyOperation( operation );
					}
				}
			}

			// Get the selection state stored with this batch.
			const selectionState = undoItem.selection;

			// Take all selection ranges that were stored with undone batch.
			const ranges = selectionState.ranges;

			// The ranges will be transformed by deltas from history that took place
			// after the selection got stored.
			const deltas = this.editor.document.history.getDeltas( undoBatch.deltas[ 0 ].baseVersion );

			// This will keep the transformed ranges.
			const transformedRanges = [];

			for ( let originalRange of ranges ) {
				// We create `transformed` array. At the beginning it will have only the original range.
				// During transformation the original range will change or even break into smaller ranges.
				// After the range is broken into two ranges, we have to transform both of those ranges separately.
				// For that reason, we keep all transformed ranges in one array and operate on it.
				let transformed = [ originalRange ];

				for ( let delta of deltas ) {
					for ( let operation of delta.operations ) {
						// We look through all operations from all deltas.

						for ( let t = 0; t < transformed.length; t++ ) {
							// We transform every range by every operation.
							// We keep current state of transformation in `transformed` array and update it.
							let result;

							switch ( operation.type ) {
								case 'insert':
									result = transformed[ t ].getTransformedByInsertion(
										operation.position,
										operation.nodeList.length,
										true,
										false
									);
									break;

								case 'move':
								case 'remove':
								case 'reinsert':
									result = transformed[ t ].getTransformedByMove(
										operation.sourcePosition,
										operation.targetPosition,
										operation.howMany,
										true,
										false
									);
									break;
							}

							// If we have a transformation result, we substitute it in `transformed` array with
							// the range that got transformed. Keep in mind that the result is an array
							// and may contain multiple ranges.
							if ( result ) {
								transformed.splice( t, 1, ...result );

								// Fix iterator.
								t = t + result.length - 1;
							}
						}
					}
				}

				// After `originalRange` got transformed, we have an array of ranges. Some of those
				// ranges may be "touching" -- they can be next to each other and could be merged.
				// Let's do this. First, we have to sort those ranges because they don't have to be
				// in an order.
				transformed.sort( ( a, b ) => a.start.isBefore( b.start ) ? -1 : 1 );

				// Then we check if two consecutive ranges are touching. We can do it pair by pair
				// in one dimensional loop because ranges are sorted.
				for ( let i = 1; i < transformed.length; i++ ) {
					let a = transformed[ i - 1 ];
					let b = transformed[ i ];

					if ( a.end.isTouching( b.start ) ) {
						a.end = b.end;
						transformed.splice( i, 1 );
						i--;
					}
				}

				// For each `originalRange` from `ranges`, we take only one transformed range.
				// This is because we want to prevent situation where single-range selection
				// got transformed to mulit-range selection. We will take the first range that
				// is not in the graveyard.
				const transformedRange = transformed.find(
					( range ) => range.start.root != this.editor.document.graveyard
				);

				if ( transformedRange ) {
					transformedRanges.push( transformedRange );
				}
			}

			// `transformedRanges` may be empty if all ranges ended up in graveyard.
			// If that is the case, do not restore selection.
			if ( transformedRanges.length ) {
				this.editor.document.selection.setRanges( transformedRanges, selectionState.isBackward );
			}
		} );

		this.refreshState();
		this.fire( 'revert', undoBatch );

		function postFix( deltas, historyDeltas ) {
			// Post fix #1 - insert/move operations point to the same place:
			// foobar --- move ---> fbaroo --- move --> barofo --- undo --> fbaroo --- undo --> oofbar/foobar
			//                                                                         move oo conflicts with move f
			for ( let upDelta of deltas ) {
				// We are only interested in MoveDelta conflicts.
				if ( !( upDelta instanceof MoveDelta ) ) {
					continue;
				}

				for ( let hDelta of historyDeltas ) {
					// We are only interested in MoveDelta conflicts.
					if ( !( hDelta instanceof MoveDelta ) ) {
						continue;
					}

					if ( !hDelta.batch || ( hDelta.batch.type != 'undo' && hDelta.batch.type != 'redo' ) ) {
						// We can only decide when we know context/past states of deltas.
						// So we can only check undo batches.
						continue;
					}

					// Since these are MoveDeltas we expect only one MoveOperation for each.
					let upOp = upDelta.operations[ 0 ];
					let hOp = hDelta.operations[ 0 ];

					if ( upOp.targetPosition.isEqual( hOp.targetPosition ) ) {
						// These could be either MoveDeltas or InsertDeltas.
						let origUpDelta = originalDeltas.get( upDelta );
						let origHDelta = originalDeltas.get( hDelta );

						/* istanbul ignore next */
						if ( !origUpDelta || !origHDelta ) {
							continue;
						}

						let origUpOp = origUpDelta.operations[ 0 ];
						let origHOp = origHDelta.operations[ 0 ];

						let upPos = origUpOp.sourcePosition || origUpOp.position;
						let hPos = origHOp.sourcePosition || origHOp.position;

						if ( upPos.isAfter( hPos ) ) {
							upOp.targetPosition.offset += hOp.howMany;
							upOp.movedRangeStart.offset += hOp.howMany;
						}
					}
				}
			}
		}
	}
}

/**
 * Fired after `UndoCommand` reverts a batch.
 *
 * @event undo.UndoCommand#revert
 * @param {engine.model.Batch} undoBatch The batch instance that got reverted.
 */
